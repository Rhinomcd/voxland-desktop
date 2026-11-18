/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { createPressTracker } from "./pressTracker";

const setup = () => {
    const send = vi.fn();
    return { send, presses: createPressTracker(send) };
};

describe("createPressTracker", () => {
    it("presses and releases a single source", () => {
        const { send, presses } = setup();
        presses.set("pushToTalk", true, "a");
        presses.set("pushToTalk", false, "a");
        expect(send.mock.calls).toEqual([
            ["pushToTalk", true],
            ["pushToTalk", false]
        ]);
    });

    it("keeps an action pressed until every source releases it", () => {
        const { send, presses } = setup();
        presses.set("pushToTalk", true, "bind1");
        presses.set("pushToTalk", true, "bind2");
        presses.set("pushToTalk", false, "bind1");
        expect(send.mock.calls).toEqual([["pushToTalk", true]]);

        presses.set("pushToTalk", false, "bind2");
        expect(send.mock.calls).toEqual([
            ["pushToTalk", true],
            ["pushToTalk", false]
        ]);
    });

    it("ignores repeated presses and releases it never saw pressed", () => {
        const { send, presses } = setup();
        presses.set("toggleMute", false, "a");
        presses.set("toggleMute", true, "a");
        presses.set("toggleMute", true, "a");
        presses.set("toggleMute", false, "b");
        expect(send.mock.calls).toEqual([["toggleMute", true]]);
    });

    it("releases everything one source holds", () => {
        const { send, presses } = setup();
        presses.set("pushToTalk", true, "portal");
        presses.set("toggleMute", true, "portal");
        presses.set("toggleMute", true, "bind");
        presses.releaseSource("portal");
        expect(send.mock.calls).toEqual([
            ["pushToTalk", true],
            ["toggleMute", true],
            ["pushToTalk", false]
        ]);
    });
});
