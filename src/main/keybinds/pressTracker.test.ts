/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { createPressTracker } from "./pressTracker";

const setup = () => {
    const send = vi.fn();
    return { send, presses: createPressTracker(send, action => action === "pushToTalk") };
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
        presses.set("pushToTalk", false, "a");
        presses.set("pushToTalk", true, "a");
        presses.set("pushToTalk", true, "a");
        presses.set("pushToTalk", false, "b");
        expect(send.mock.calls).toEqual([["pushToTalk", true]]);
    });

    it("passes presses of other actions through, so overlapping toggles each fire", () => {
        const { send, presses } = setup();
        presses.set("toggleMute", true, "bind");
        presses.set("toggleMute", true, "tap");
        presses.set("toggleMute", false, "tap");
        presses.set("toggleMute", false, "bind");
        expect(send.mock.calls).toEqual([
            ["toggleMute", true],
            ["toggleMute", true],
            ["toggleMute", false],
            ["toggleMute", false]
        ]);
    });

    it("ignores a release of another action whose press it never saw", () => {
        const { send, presses } = setup();
        presses.set("toggleMute", false, "bind");
        expect(send.mock.calls).toEqual([]);
    });

    it("releases the hold actions a source holds, once, without firing its toggles", () => {
        const { send, presses } = setup();
        presses.set("pushToTalk", true, "portal");
        presses.set("toggleMute", true, "portal");
        presses.releaseSource("portal");
        presses.releaseSource("portal");
        presses.set("toggleMute", false, "portal");
        expect(send.mock.calls).toEqual([
            ["pushToTalk", true],
            ["toggleMute", true],
            ["pushToTalk", false]
        ]);
    });
});
