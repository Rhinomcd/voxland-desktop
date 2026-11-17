/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";

import type { LinkData, Node, PatchBay as PatchBayType } from "@vencord/venmic";
import { app, type WebContents } from "electron";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import type { AudioApp, AudioAppList, AudioRequest } from "shared/screenShareAudio";

import {
    getHyprlandWindows,
    getProcesses,
    type HyprlandWindow,
    type ProcessInfo,
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

let warnedAboutPwDump = false;

async function getPipeWireClients() {
    const clients = new Map<string, PipeWireClient>();

    try {
        const { stdout } = await execFileAsync("pw-dump", ["PipeWire:Interface:Client"], {
            maxBuffer: 32 << 20,
            timeout: 5000
        });
        const objects: { id: number; info?: { props?: Record<string, string | number> } }[] = JSON.parse(stdout);

        for (const { id, info } of objects) {
            const props = info?.props ?? {};
            clients.set(String(id), {
                pid: Number(props["application.process.id"]) || undefined,
                binary: props["application.process.binary"]?.toString()
            });
        }
    } catch (e) {
        if (!warnedAboutPwDump) console.warn("pw-dump failed; apps that put no pid on their nodes can't be matched", e);
        warnedAboutPwDump = true;
        return null;
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

function groupAudioApps(
    nodes: Node[],
    clients: Map<string, PipeWireClient>,
    windows: HyprlandWindow[],
    processes: Map<number, ProcessInfo>
): AudioApp[] {
    const { deviceSelect = false } = Settings.store.audio ?? {};
    const ownPids = new Set(getOwnPids());

    // Chromium-based apps play audio from a child of the process that owns the window
    const windowFor = (pid: number) =>
        windows.find(w => w.pid === pid) ?? windows.find(w => w.pid === processes.get(pid)?.ppid);

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
              ? appIdOf(window?.pid ?? pid, processes)
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

function appIdOf(pid: number, processes: Map<number, ProcessInfo>) {
    return `pid:${pid}@${processes.get(pid)?.start ?? ""}`;
}

interface KnownApp {
    app: AudioApp;
    /** start time of each pid when it was seen; undefined when /proc couldn't show it */
    starts: Map<number, string | undefined>;
}

/** Apps seen while picking, so a choice survives the app going quiet; each pid is dropped once it exits. */
const knownApps = new Map<string, KnownApp>();

function isSameProcess(pid: number, start: string | undefined, processes: Map<number, ProcessInfo>) {
    // an unreadable pid (another pid namespace, hidepid) is trusted only while it stays unreadable
    return processes.get(pid)?.start === start;
}

function rememberApps(apps: AudioApp[], processes: Map<number, ProcessInfo>) {
    for (const app of apps) {
        knownApps.set(app.id, { app, starts: new Map(app.pids.map(pid => [pid, processes.get(pid)?.start])) });
    }
    for (const [id, { starts }] of knownApps) {
        if (![...starts].some(([pid, start]) => isSameProcess(pid, start, processes)) && starts.size) {
            knownApps.delete(id);
        }
    }
}

/** Matchers for an app that went quiet: its live pids, plus client ids only where over-matching is harmless. */
function rememberedMatchers(id: string, processes: Map<number, ProcessInfo>, keepClientIds: boolean) {
    const known = knownApps.get(id);
    if (!known) return [];

    return known.app.match.filter(m => {
        if (m["client.id"]) return keepClientIds;
        const pid = Number(m["application.process.id"]);
        return !pid || isSameProcess(pid, known.starts.get(pid), processes);
    });
}

async function takeSnapshot(venmic: PatchBayType) {
    const nodes = venmic.list([]);
    const [clients, windows, processes] = await Promise.all([
        getPipeWireClients(),
        getHyprlandWindows(),
        getProcesses()
    ]);
    const apps = groupAudioApps(nodes, clients ?? new Map(), windows ?? [], processes);
    rememberApps(apps, processes);

    return { nodes, apps, windows, processes, hasClients: clients !== null };
}

type Snapshot = Awaited<ReturnType<typeof takeSnapshot>>;

// venmic treats an empty include list as "everything", so silence needs a matcher no node has
const MATCH_NOTHING: Node[] = [{ "node.name": "voxland-match-nothing" }];

function sortedMatches(matches: Node[]) {
    return uniqueMatches(matches).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/**
 * Null keeps the current link: a failed lookup must not reroute or silence a live stream. The first link
 * always goes through, because the renderer only looks for the virtual mic once, right after Go Live.
 */
function resolveLinkData(request: AudioRequest, snapshot: Snapshot): LinkData | null {
    const current = new Map(snapshot.apps.map(a => [a.id, a]));
    const matchersOf = (ids: string[], keepClientIds: boolean) =>
        ids.flatMap(id => current.get(id)?.match ?? rememberedMatchers(id, snapshot.processes, keepClientIds));
    const including = (matches: Node[]) =>
        buildLinkData({ include: matches.length ? sortedMatches(matches) : MATCH_NOTHING });
    const lookupFailed = !snapshot.hasClients || !snapshot.windows;

    if (request.kind === "none") return including([]);
    if (activeData && lookupFailed) return null;

    switch (request.kind) {
        case "system":
            // exclusions resolve through pw-dump client pids and hyprctl window grouping; start silent without them
            if (request.exclude.length && lookupFailed) return including([]);
            // a reused client id here can only leave out too much, never share too much
            return buildLinkData({ exclude: sortedMatches(matchersOf(request.exclude, true)) });
        case "apps":
            return including(matchersOf(request.apps, false));
        case "window": {
            if (!snapshot.windows) return including([]);

            const { pid, address } = request.window;
            if (!snapshot.windows.some(w => w.address === address && w.pid === pid)) return including([]);

            const pids = withDescendants(pid, snapshot.processes);
            const windowApps = snapshot.apps.filter(a => a.pids.some(p => pids.includes(p)));
            return including([
                ...windowApps.flatMap(a => a.match),
                ...pids.map(p => ({ "application.process.id": String(p) }))
            ]);
        }
    }
}

const matchesAny = (targets: Node[], node: Node) =>
    targets.some(t => Object.entries(t).every(([key, value]) => node[key] === value));

function linkedNodes(data: LinkData, nodes: Node[]) {
    return nodes
        .filter(n => (!data.include.length || matchesAny(data.include, n)) && !matchesAny(data.exclude, n))
        .map(n => n["object.serial"] ?? n["object.id"])
        .sort()
        .join(",");
}

let activeRequest: AudioRequest | null = null;
let activeData: LinkData | null = null;
let refreshTimer: NodeJS.Timeout | undefined;
let generation = 0;
let detachFromRenderer: (() => void) | undefined;

async function applyActiveRequest(venmic: PatchBayType) {
    const request = activeRequest;
    if (!request) return;

    const snapshot = await takeSnapshot(venmic);
    if (request !== activeRequest) return;

    const data = resolveLinkData(request, snapshot);
    if (!data) return;

    // venmic.link() tears down every link first and links new nodes under the current options by itself, so
    // relink only when a node would change sides, or to drop filters a reused pid could otherwise match
    const goingSilent = data.include === MATCH_NOTHING && activeData?.include !== MATCH_NOTHING;
    if (activeData && !goingSilent && linkedNodes(activeData, snapshot.nodes) === linkedNodes(data, snapshot.nodes))
        return;

    venmic.link(data);
    activeData = data;
}

/** Re-resolves while sharing so audio follows processes and PipeWire clients that appear after Go Live. */
function scheduleRefresh(venmic: PatchBayType, gen: number) {
    refreshTimer = setTimeout(async () => {
        await applyActiveRequest(venmic).catch(console.error);
        if (gen === generation) scheduleRefresh(venmic, gen);
    }, 3000);
}

function stopVirtmic() {
    clearTimeout(refreshTimer);
    generation++;
    activeRequest = null;
    activeData = null;
    detachFromRenderer?.();
    detachFromRenderer = undefined;
    obtainVenmic()?.unlink();
}

/** The renderer normally stops the share; this covers reloads and crashes that never send STREAM_CLOSE. */
function stopWhenRendererGoes(renderer: WebContents) {
    detachFromRenderer?.();
    const stop = () => stopVirtmic();
    renderer.once("render-process-gone", stop);
    renderer.once("did-navigate", stop);
    renderer.once("destroyed", stop);
    detachFromRenderer = () => {
        renderer.off("render-process-gone", stop);
        renderer.off("did-navigate", stop);
        renderer.off("destroyed", stop);
    };
}

handle(IpcEvents.VIRT_MIC_LIST, async (): Promise<AudioAppList> => {
    const venmic = obtainVenmic();
    return venmic
        ? { ok: true, apps: (await takeSnapshot(venmic)).apps, hasPipewirePulse }
        : { ok: false, isGlibCxxOutdated };
});

handle(IpcEvents.VIRT_MIC_START, async (e, request: AudioRequest) => {
    const venmic = obtainVenmic();
    if (!venmic) return;

    clearTimeout(refreshTimer);
    const gen = ++generation;
    activeRequest = request;
    activeData = null;
    stopWhenRendererGoes(e.sender);
    await applyActiveRequest(venmic).catch(console.error);

    if (gen === generation) scheduleRefresh(venmic, gen);
});

handle(IpcEvents.VIRT_MIC_UNMUTE, () => {
    return obtainVenmic()?.unmute();
});

handle(IpcEvents.VIRT_MIC_STOP, () => stopVirtmic());
