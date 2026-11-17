/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { lstat, readdir, readFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import type { CaptureTarget } from "shared/screenShareAudio";

const execFileAsync = promisify(execFile);

/** Written by scripts/linux/voxland-record-share-pick, which wraps the xdg-desktop-portal-hyprland picker. */
const PICK_FILE = process.env.XDG_RUNTIME_DIR && join(process.env.XDG_RUNTIME_DIR, "voxland-share-pick");

export interface HyprlandWindow {
    address: string;
    class: string;
    title: string;
    pid: number;
}

/** Resolves to null when hyprctl fails, so callers can tell a failed lookup from a closed window. */
export async function getHyprlandWindows(): Promise<HyprlandWindow[] | null> {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return [];

    try {
        const { stdout } = await execFileAsync("hyprctl", ["clients", "-j"], { timeout: 5000 });
        return JSON.parse(stdout);
    } catch {
        return null;
    }
}

export interface ProcessInfo {
    ppid: number;
    /** start time in clock ticks since boot; tells a reused pid from the original process */
    start: string;
}

export async function getProcesses() {
    const processes = new Map<number, ProcessInfo>();

    await Promise.all(
        (await readdir("/proc")).map(async name => {
            if (!/^\d+$/.test(name)) return;

            const procStat = await readFile(`/proc/${name}/stat`, "utf8").catch(() => null);
            if (!procStat) return;

            // the comm field may contain spaces and parentheses, so parse from the last ')'
            const fields = procStat.slice(procStat.lastIndexOf(")") + 2).split(" ");
            processes.set(Number(name), { ppid: Number(fields[1]), start: fields[19] });
        })
    );

    return processes;
}

export function withDescendants(root: number, processes: Map<number, ProcessInfo>) {
    const tree = new Set([root]);
    let grew = true;

    while (grew) {
        grew = false;
        for (const [pid, { ppid }] of processes) {
            if (tree.has(ppid) && !tree.has(pid)) {
                tree.add(pid);
                grew = true;
            }
        }
    }

    return [...tree];
}

interface PortalPick {
    selection: string;
    windows: { handle: string; class: string; title: string; address?: bigint }[];
}

/**
 * The record holds the picker's stdout on the first line and XDPH_WINDOW_SHARING_LIST after it.
 * List entries look like `handle[HC>]class[HT>]title[HE>]address[HA>]`; older xdph omits the address.
 */
export function parsePortalPick(record: string): PortalPick | null {
    const newline = record.indexOf("\n");
    const firstLine = newline === -1 ? record : record.slice(0, newline);
    const marker = firstLine.indexOf("[SELECTION]");
    if (marker === -1) return null;

    const selection = firstLine.slice(marker + "[SELECTION]".length).replace(/^[^/]*\//, "");
    const list = newline === -1 ? "" : record.slice(newline + 1);
    const windows = [...list.matchAll(/(\d+)\[HC>\](.*?)\[HT>\](.*?)\[HE>\](?:(\d+)\[HA>\])?/gs)].map(
        ([, handle, windowClass, title, address]) => ({
            handle,
            class: windowClass,
            title,
            address: address && address !== "0" ? BigInt(address) : undefined
        })
    );

    return { selection, windows };
}

function findPickedWindow(pick: PortalPick, windows: HyprlandWindow[]) {
    if (!pick.selection.startsWith("window:")) return null;

    const handle = pick.selection.slice("window:".length);
    const entry = pick.windows.find(w => w.handle === handle);
    if (!entry) return null;

    if (entry.address !== undefined) {
        return windows.find(w => BigInt(w.address) === entry.address) ?? null;
    }

    const sameName = windows.filter(w => w.class === entry.class && w.title === entry.title);
    return sameName.length === 1 ? sameName[0] : null;
}

/**
 * Resolves what the user chose in the portal dialog. Chromium only gets back an opaque PipeWire stream,
 * so this relies on the picker hook having recorded the choice after `since`.
 */
export async function readCaptureTarget(since: number): Promise<CaptureTarget | null> {
    try {
        return await resolvePick(since);
    } catch (e) {
        console.error("Failed to resolve the portal pick", e);
        return null;
    }
}

// xdph selections: screen:<output>, region:<output>@..., workspace:<name>, workspace-id:<id>, window:<handle>
const WHOLE_SCREEN_SELECTIONS = ["screen:", "region:", "workspace:", "workspace-id:"];

async function resolvePick(since: number): Promise<CaptureTarget | null> {
    if (!PICK_FILE) return null;

    const file = await lstat(PICK_FILE).catch(() => null);
    if (!file?.isFile() || file.uid !== process.getuid?.() || file.mtimeMs < since) return null;

    const pick = parsePortalPick(await readFile(PICK_FILE, "utf8"));
    if (!pick) return null;
    if (WHOLE_SCREEN_SELECTIONS.some(prefix => pick.selection.startsWith(prefix))) return { kind: "screen" };
    if (!pick.selection.startsWith("window:")) return null;

    const [windows, processes] = await Promise.all([getHyprlandWindows(), getProcesses()]);
    const window = windows && findPickedWindow(pick, windows);
    if (!window || window.pid <= 1) return null;

    return {
        kind: "window",
        label: window.title || window.class,
        window: { pid: window.pid, address: window.address },
        pids: withDescendants(window.pid, processes)
    };
}
