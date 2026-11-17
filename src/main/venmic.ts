/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";

import type { LinkData, Node, PatchBay as PatchBayType } from "@vencord/venmic";
import { app } from "electron";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import type { AudioApp, AudioAppList, AudioRequest } from "shared/screenShareAudio";

import {
    getHyprlandWindows,
    getParentPids,
    type HyprlandWindow,
    sharedWindowPid,
    withDescendants
} from "./captureTarget";
import { Settings } from "./settings";
import { handle } from "./utils/ipcWrappers";

const execFileAsync = promisify(execFile);

let PatchBay: typeof PatchBayType | undefined;
let patchBayInstance: PatchBayType | undefined;

let imported = false;
let initialized = false;

let hasPipewirePulse = false;
let isGlibCxxOutdated = false;

function importVenmic() {
    if (imported) {
        return;
    }

    imported = true;

    try {
        PatchBay = (require(join(STATIC_DIR, `dist/venmic-${process.arch}.node`)) as typeof import("@vencord/venmic"))
            .PatchBay;

        hasPipewirePulse = PatchBay.hasPipeWire();
    } catch (e: any) {
        console.error("Failed to import venmic", e);
        isGlibCxxOutdated = (e?.stack || e?.message || "").toLowerCase().includes("glibc");
    }
}

function obtainVenmic() {
    if (!imported) {
        importVenmic();
    }

    if (PatchBay && !initialized) {
        initialized = true;

        try {
            patchBayInstance = new PatchBay();
        } catch (e: any) {
            console.error("Failed to instantiate venmic", e);
        }
    }

    return patchBayInstance;
}

function getOwnPids() {
    return app.getAppMetrics().map(proc => proc.pid);
}

function buildLinkData({ include, exclude }: { include?: Node[]; exclude?: Node[] }) {
    const ownPids = getOwnPids().map(String);

    const { mute, ignoreDevices, ignoreInputMedia, ignoreVirtual, workaround, onlySpeakers, onlyDefaultSpeakers } =
        Settings.store.audio ?? {};

    const data: LinkData = {
        mute: mute ?? true,
        include: include ?? [],
        exclude: exclude ?? [],
        only_speakers: onlySpeakers,
        ignore_devices: ignoreDevices,
        only_default_speakers: onlyDefaultSpeakers
    };

    data.exclude.push(...ownPids.map(pid => ({ "application.process.id": pid })));

    if (ignoreInputMedia ?? true) {
        data.exclude.push({ "media.class": "Stream/Input/Audio" });
    }

    if (ignoreVirtual) {
        data.exclude.push({ "node.virtual": "true" });
    }

    if (workaround) {
        data.workaround = ownPids.map(pid => ({ "application.process.id": pid, "media.name": "RecordStream" }));
    }

    return data;
}

interface PipeWireClient {
    pid?: number;
    binary?: string;
}

async function getPipeWireClients() {
    const clients = new Map<string, PipeWireClient>();

    try {
        const { stdout } = await execFileAsync("pw-dump", ["PipeWire:Interface:Client"], { maxBuffer: 32 << 20 });
        const objects: { id: number; info?: { props?: Record<string, string | number> } }[] = JSON.parse(stdout);

        for (const { id, info } of objects) {
            const props = info?.props ?? {};
            clients.set(String(id), {
                pid: Number(props["application.process.id"]) || undefined,
                binary: props["application.process.binary"]?.toString()
            });
        }
    } catch (e) {
        console.warn("pw-dump failed, audio sources will lack per-process info", e);
    }

    return clients;
}

const DAEMON_BINARIES = new Set(["pipewire", "wireplumber"]);

function isListedNode(node: Node, deviceSelect: boolean) {
    if (node["node.name"]?.startsWith("venmic-loopback")) return false;
    if (deviceSelect) return !!node["media.class"]?.includes("Audio");
    return node["media.class"] === "Stream/Output/Audio" && !node["device.id"];
}

interface AppGroup {
    nodes: Node[];
    pids: Set<number>;
    binary?: string;
    window?: HyprlandWindow;
}

async function listAudioApps(nodes: Node[]): Promise<AudioApp[]> {
    const { deviceSelect = false } = Settings.store.audio ?? {};
    const [clients, windows, parents] = await Promise.all([
        getPipeWireClients(),
        getHyprlandWindows(),
        getParentPids()
    ]);
    const ownPids = new Set(getOwnPids());

    // Chromium-based apps play audio from a child of the process that owns the window
    const windowFor = (pid: number) =>
        windows.find(w => w.pid === pid) ?? windows.find(w => w.pid === parents.get(pid));

    const groups = new Map<string, AppGroup>();

    for (const node of nodes) {
        if (!isListedNode(node, deviceSelect)) continue;

        // ALSA-plugin and native apps may put no pid on their nodes, but the client that created them has one.
        // Nodes made by daemon modules (filter chains, loopbacks) belong to the daemon's own client instead.
        const client = clients.get(node["client.id"]);
        const fromClient = client && !DAEMON_BINARIES.has(client.binary ?? "") ? client : undefined;
        const pid = Number(node["application.process.id"]) || fromClient?.pid;
        if (pid && ownPids.has(pid)) continue;

        const isDevice = !!node["device.id"];
        const window = pid && !isDevice ? windowFor(pid) : undefined;
        const key = isDevice
            ? `device:${node["node.name"]}`
            : pid
              ? `pid:${window?.pid ?? pid}`
              : `name:${node["application.name"] ?? node["node.name"]}`;

        const group = groups.get(key) ?? { nodes: [], pids: new Set() };
        group.nodes.push(node);
        if (pid && !isDevice) group.pids.add(pid);
        group.window ??= window;
        group.binary ??= node["application.process.binary"] ?? fromClient?.binary;
        groups.set(key, group);
    }

    const windowTitles = new Map<string, string>();
    const apps = [...groups].map(([id, { nodes, pids, binary, window }]): AudioApp => {
        const [first] = nodes;
        const appName = first["application.name"];
        const alsaName = appName?.match(/^PipeWire ALSA \[(.+)\]$/)?.[1];
        const appLabel = appName && !alsaName ? appName.charAt(0).toUpperCase() + appName.slice(1) : undefined;
        if (window?.title) windowTitles.set(id, window.title);

        const label =
            (first["device.id"] && first["node.description"]) ||
            appLabel ||
            window?.title ||
            binary ||
            alsaName ||
            first["node.description"] ||
            first["node.name"] ||
            id;

        const match: Node[] = [];
        if (first["device.id"]) {
            match.push({ "node.name": first["node.name"] });
        } else if (pids.size) {
            match.push(...[...pids].map(pid => ({ "application.process.id": String(pid) })));
            for (const node of nodes) {
                if (!node["application.process.id"] && node["client.id"]) {
                    match.push({ "client.id": node["client.id"] });
                }
            }
        } else {
            match.push(appName ? { "application.name": appName } : { "node.name": first["node.name"] });
        }

        return { id, label, pids: [...pids], match: uniqueMatches(match) };
    });

    const labelCounts = new Map<string, number>();
    for (const { label } of apps) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);

    const disambiguate = (a: AudioApp) =>
        windowTitles.has(a.id) && windowTitles.get(a.id) !== a.label
            ? `${a.label}: ${windowTitles.get(a.id)}`
            : `${a.label} (${a.pids[0]})`;

    return apps
        .map(a => (labelCounts.get(a.label)! > 1 && a.pids.length ? { ...a, label: disambiguate(a) } : a))
        .sort((a, b) => a.label.localeCompare(b.label));
}

function uniqueMatches(matches: Node[]) {
    const seen = new Set<string>();
    return matches.filter(m => {
        const key = JSON.stringify(m);
        return !seen.has(key) && seen.add(key);
    });
}

const knownApps = new Map<string, AudioApp>();

async function listAndRemember(venmic: PatchBayType) {
    const apps = await listAudioApps(venmic.list([]));
    for (const a of apps) knownApps.set(a.id, a);
    return apps;
}

async function resolveLinkData(request: AudioRequest, venmic: PatchBayType): Promise<LinkData | null> {
    const apps = await listAndRemember(venmic);
    const current = new Map(apps.map(a => [a.id, a]));

    // an app that went quiet keeps its pid matchers; its client ids may be reused by other apps by now
    const matchersOf = (ids: string[]) =>
        ids.flatMap(id => current.get(id)?.match ?? knownApps.get(id)?.match.filter(m => !m["client.id"]) ?? []);

    switch (request.kind) {
        case "none":
            return null;
        case "system":
            return buildLinkData({ exclude: matchersOf(request.exclude) });
        case "apps": {
            // venmic treats an empty include list as "everything"
            const include = matchersOf(request.apps);
            return include.length ? buildLinkData({ include }) : null;
        }
        case "window": {
            if (!sharedWindowPid) return null;
            const pids = withDescendants(sharedWindowPid, await getParentPids());
            const windowApps = apps.filter(a => a.pids.some(pid => pids.includes(pid)));
            return buildLinkData({
                include: [
                    ...windowApps.flatMap(a => a.match),
                    ...pids.map(pid => ({ "application.process.id": String(pid) }))
                ]
            });
        }
    }
}

let activeRequest: AudioRequest | null = null;
let activeLink = "";
let refreshTimer: NodeJS.Timeout | undefined;

/** Re-resolved on a timer so shares follow processes and PipeWire clients that appear after Go Live. */
async function applyActiveRequest(venmic: PatchBayType) {
    const request = activeRequest;
    if (!request) return;

    const data = await resolveLinkData(request, venmic);
    if (request !== activeRequest) return;

    if (!data) {
        stopVirtmic(venmic);
        return;
    }

    const serialized = JSON.stringify(data);
    if (serialized !== activeLink) {
        activeLink = serialized;
        venmic.link(data);
    }
}

function stopVirtmic(venmic: PatchBayType) {
    clearInterval(refreshTimer);
    activeRequest = null;
    activeLink = "";
    venmic.unlink();
}

handle(IpcEvents.VIRT_MIC_LIST, async (): Promise<AudioAppList> => {
    const venmic = obtainVenmic();
    return venmic
        ? { ok: true, apps: await listAndRemember(venmic), hasPipewirePulse }
        : { ok: false, isGlibCxxOutdated };
});

handle(IpcEvents.VIRT_MIC_START, async (_, request: AudioRequest) => {
    const venmic = obtainVenmic();
    if (!venmic) return;

    clearInterval(refreshTimer);
    activeRequest = request;
    activeLink = "";
    await applyActiveRequest(venmic);

    if (activeRequest === request && request.kind !== "none") {
        refreshTimer = setInterval(() => applyActiveRequest(venmic).catch(console.error), 3000);
    }
});

handle(IpcEvents.VIRT_MIC_UNMUTE, () => {
    return obtainVenmic()?.unmute();
});

handle(IpcEvents.VIRT_MIC_STOP, () => {
    const venmic = obtainVenmic();
    if (venmic) stopVirtmic(venmic);
});
