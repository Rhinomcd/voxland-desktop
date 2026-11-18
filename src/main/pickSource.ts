/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Streams } from "electron";
import type { StreamPick } from "shared/screenShare";
import type { CaptureTarget } from "shared/screenShareAudio";

import { isDiscordUrl } from "./utils/isDiscordUrl";

export interface Host {
    platform: NodeJS.Platform;
    env: Record<string, string | undefined>;
    osRelease: string;
}

export interface CapturerSource {
    id: string;
    name: string;
    thumbnail: { toDataURL(): string };
}

export interface PickerScreen {
    id: string;
    name: string;
    url: string;
}

export interface PickerRequest {
    screens: PickerScreen[];
    skipPicker: boolean;
    target?: CaptureTarget | null;
}

export interface PickSourceDeps {
    getSources(thumbnailWidth: number): Promise<CapturerSource[]>;
    readCaptureTarget(requestedAt: number): Promise<CaptureTarget | null>;
    openPicker(request: PickerRequest): Promise<StreamPick | null>;
}

interface DisplayMediaRequest {
    frame: { top: { url: string } | null } | null;
}

interface Strategy {
    thumbnailWidth: number;
    pick(sources: CapturerSource[], requestedAt: number): Promise<Streams | null>;
}

const toScreen = ({ id, name, thumbnail }: CapturerSource): PickerScreen => ({ id, name, url: thumbnail.toDataURL() });

function isWayland({ platform, env }: Host) {
    return platform === "linux" && (env.XDG_SESSION_TYPE === "wayland" || !!env.WAYLAND_DISPLAY);
}

export function createSourcePicker(host: Host, deps: PickSourceDeps) {
    let openPickerIds = new Set<string>();

    async function chooseFromList(sources: CapturerSource[]) {
        openPickerIds = new Set(sources.map(s => s.id));
        try {
            const choice = await deps.openPicker({ screens: sources.map(toScreen), skipPicker: false });
            const source = choice && sources.find(s => s.id === choice.id);
            return source ? { source, choice } : null;
        } finally {
            openPickerIds.clear();
        }
    }

    const wayland: Strategy = {
        // the portal only ever returns the one source the user picked, so fetch it at full size right away
        thumbnailWidth: 1920,
        async pick([video], requestedAt) {
            if (!video) return null;

            const target = await deps.readCaptureTarget(requestedAt);
            const stream = await deps.openPicker({
                screens: [{ ...toScreen(video), name: target?.kind === "window" ? target.label : video.name }],
                skipPicker: true,
                target
            });
            return stream && { video };
        }
    };

    const windowsLoopback: Strategy = {
        thumbnailWidth: 176,
        async pick(sources) {
            const picked = await chooseFromList(sources);
            if (!picked) return null;

            const streams: Streams = { video: picked.source };
            if (picked.choice.audio) {
                const build = Number(host.osRelease.split(".").pop());
                // @ts-expect-error loopbackWithoutChrome is real but not documented
                streams.audio = build >= 19045 ? "loopbackWithoutChrome" : "loopback";
            }
            return streams;
        }
    };

    const list: Strategy = {
        thumbnailWidth: 176,
        async pick(sources) {
            const picked = await chooseFromList(sources);
            return picked && { video: picked.source };
        }
    };

    const strategy = isWayland(host) ? wayland : host.platform === "win32" ? windowsLoopback : list;

    return {
        async pickSource(request: DisplayMediaRequest): Promise<Streams | null> {
            if (!isDiscordUrl(request.frame?.top?.url)) return null;

            const requestedAt = Date.now();
            try {
                const sources = await deps.getSources(strategy.thumbnailWidth);
                return await strategy.pick(sources, requestedAt);
            } catch (e) {
                console.error("Error during screenshare picker", e);
                return null;
            }
        },

        async getLargeThumbnail(id: string) {
            if (!openPickerIds.has(id)) return;

            const sources = await deps.getSources(1920);
            return sources.find(s => s.id === id)?.thumbnail.toDataURL();
        }
    };
}
