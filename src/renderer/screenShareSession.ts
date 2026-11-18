/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { StreamPick } from "shared/screenShare";
import type { AudioRequest } from "shared/screenShareAudio";

export interface VirtualMic {
    start(request: AudioRequest): Promise<void>;
    unmute(): Promise<void>;
    stop(): Promise<void>;
}

export type StreamEvent = "STREAM_UPDATE" | "STREAM_CLOSE";
type StreamEventHandler = (event: { streamKey: string }) => void;

export interface StreamDispatcher {
    subscribe(event: StreamEvent, handler: StreamEventHandler): void;
    unsubscribe(event: StreamEvent, handler: StreamEventHandler): void;
}

export interface ScreenShareSession {
    start(pick: StreamPick): Promise<void>;
    stop(): Promise<void>;
    contentHint(): string | undefined;
}

export function createScreenShareSession(
    virtmic: VirtualMic,
    dispatcher: StreamDispatcher,
    currentUserId: () => string
): ScreenShareSession {
    let active: StreamPick | null = null;
    let micLinked = false;

    // stream keys end in the streamer's user id
    const isOwnStream = (streamKey: string) => streamKey.split(":").at(-1) === currentUserId();

    const onUpdate: StreamEventHandler = ({ streamKey }) => {
        if (micLinked && isOwnStream(streamKey)) void virtmic.unmute();
    };
    const onClose: StreamEventHandler = ({ streamKey }) => {
        if (isOwnStream(streamKey)) void stop();
    };

    function releaseMic() {
        if (!micLinked) return;
        micLinked = false;
        return virtmic.stop();
    }

    async function stop() {
        if (active) {
            dispatcher.unsubscribe("STREAM_UPDATE", onUpdate);
            dispatcher.unsubscribe("STREAM_CLOSE", onClose);
            active = null;
        }
        await releaseMic();
    }

    async function start(pick: StreamPick) {
        if (!active) {
            dispatcher.subscribe("STREAM_UPDATE", onUpdate);
            dispatcher.subscribe("STREAM_CLOSE", onClose);
        }
        active = pick;

        const { audioRequest } = pick;
        if (!audioRequest) return;
        if (audioRequest.kind === "none") return releaseMic();

        micLinked = true;
        await virtmic.start(audioRequest);
    }

    return { start, stop, contentHint: () => active?.contentHint };
}
