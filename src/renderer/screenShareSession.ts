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
}

export function createScreenShareSession(
    virtmic: VirtualMic,
    dispatcher: StreamDispatcher,
    currentUserId: () => string
): ScreenShareSession {
    let listening = false;

    // stream keys end in the streamer's user id
    const isOwnStream = (streamKey: string) => streamKey.split(":").at(-1) === currentUserId();

    const onUpdate: StreamEventHandler = ({ streamKey }) => {
        if (isOwnStream(streamKey)) void virtmic.unmute();
    };
    const onClose: StreamEventHandler = ({ streamKey }) => {
        if (isOwnStream(streamKey)) void stop();
    };

    function stop() {
        if (listening) {
            dispatcher.unsubscribe("STREAM_UPDATE", onUpdate);
            dispatcher.unsubscribe("STREAM_CLOSE", onClose);
            listening = false;
        }
        return virtmic.stop();
    }

    async function start({ audioRequest }: StreamPick) {
        if (!audioRequest) return;
        if (audioRequest.kind === "none") return stop();

        if (!listening) {
            dispatcher.subscribe("STREAM_UPDATE", onUpdate);
            dispatcher.subscribe("STREAM_CLOSE", onClose);
            listening = true;
        }
        await virtmic.start(audioRequest);
    }

    return { start, stop };
}
