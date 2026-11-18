/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AudioRequest } from "shared/screenShareAudio";
import { describe, expect, it, vi } from "vite-plus/test";

import { createScreenShareSession, type StreamDispatcher, type StreamEvent } from "./screenShareSession";

const ME = "111";
const OWN_STREAM = `guild:1:2:${ME}`;
const OTHER_STREAM = "guild:1:2:999";

function setup() {
    const calls: string[] = [];
    const virtmic = {
        start: vi.fn(async (request: AudioRequest) => void calls.push(`start:${request.kind}`)),
        unmute: vi.fn(async () => void calls.push("unmute")),
        stop: vi.fn(async () => void calls.push("stop"))
    };

    const handlers = new Map<StreamEvent, Set<(e: { streamKey: string }) => void>>();
    const dispatcher: StreamDispatcher = {
        subscribe: (event, handler) => handlers.set(event, (handlers.get(event) ?? new Set()).add(handler)),
        unsubscribe: (event, handler) => void handlers.get(event)?.delete(handler)
    };
    const emit = (event: StreamEvent, streamKey: string) => handlers.get(event)?.forEach(h => h({ streamKey }));

    const session = createScreenShareSession(virtmic, dispatcher, () => ME);
    return { session, virtmic, calls, emit };
}

const pick = (audioRequest?: AudioRequest, contentHint = "motion") => ({
    id: "screen:0",
    audio: true,
    contentHint,
    audioRequest
});
const system: AudioRequest = { kind: "system", exclude: [] };
const apps: AudioRequest = { kind: "apps", apps: ["firefox"] };

describe("ScreenShareSession", () => {
    it("starts the virtual mic with the picked sources", async () => {
        const { session, virtmic } = setup();

        await session.start(pick(apps));

        expect(virtmic.start).toHaveBeenCalledExactlyOnceWith(apps);
    });

    it("unmutes on updates to its own stream only", async () => {
        const { session, calls, emit } = setup();
        await session.start(pick(system));

        emit("STREAM_UPDATE", OTHER_STREAM);
        emit("STREAM_UPDATE", OWN_STREAM);

        expect(calls).toEqual(["start:system", "unmute"]);
    });

    it("releases the virtual mic when its own stream closes, then stops listening", async () => {
        const { session, calls, emit } = setup();
        await session.start(pick(system));

        emit("STREAM_CLOSE", OTHER_STREAM);
        emit("STREAM_CLOSE", OWN_STREAM);
        emit("STREAM_UPDATE", OWN_STREAM);
        emit("STREAM_CLOSE", OWN_STREAM);

        expect(calls).toEqual(["start:system", "stop"]);
    });

    it("relinks without stopping when a new stream starts while one is open", async () => {
        const { session, calls, emit } = setup();
        await session.start(pick(system));

        await session.start(pick(apps));
        emit("STREAM_UPDATE", OWN_STREAM);
        emit("STREAM_CLOSE", OWN_STREAM);

        expect(calls).toEqual(["start:system", "start:apps", "unmute", "stop"]);
    });

    it("releases the virtual mic when the new stream has no audio", async () => {
        const { session, calls, emit } = setup();
        await session.start(pick(system));

        await session.start(pick({ kind: "none" }));
        emit("STREAM_UPDATE", OWN_STREAM);

        expect(calls).toEqual(["start:system", "stop"]);
    });

    it("leaves the virtual mic alone when the platform picks audio itself", async () => {
        const { session, calls, emit } = setup();

        await session.start(pick());
        emit("STREAM_CLOSE", OWN_STREAM);

        expect(calls).toEqual([]);
    });

    it("still releases the virtual mic on close after a failed start", async () => {
        const { session, virtmic, calls, emit } = setup();
        virtmic.start.mockRejectedValueOnce(new Error("venmic unavailable"));

        await expect(session.start(pick(system))).rejects.toThrow("venmic unavailable");
        emit("STREAM_CLOSE", OWN_STREAM);

        expect(calls).toEqual(["stop"]);
    });

    it("reports the active pick's content hint until the session stops", async () => {
        const { session } = setup();
        expect(session.contentHint()).toBeUndefined();

        await session.start(pick(system, "motion"));
        expect(session.contentHint()).toBe("motion");

        await session.start(pick(undefined, "detail"));
        expect(session.contentHint()).toBe("detail");

        await session.stop();
        expect(session.contentHint()).toBeUndefined();
    });

    it("clears the content hint when its own stream closes, even without audio", async () => {
        const { session, emit } = setup();
        await session.start(pick(undefined, "detail"));

        emit("STREAM_CLOSE", OTHER_STREAM);
        expect(session.contentHint()).toBe("detail");

        emit("STREAM_CLOSE", OWN_STREAM);
        expect(session.contentHint()).toBeUndefined();
    });
});
