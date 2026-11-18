/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { createBindTracker } from "./bindTracker";

const CTRL_LEFT = 29;
const CTRL_RIGHT = 3613;

const setup = (...binds: string[][]) => {
    const onChange = vi.fn();
    const tracker = createBindTracker(onChange);
    const objects = binds.map(keys => ({ keys }));
    tracker.setBinds(objects);
    const changes = () => onChange.mock.calls.map(([bind, active]) => [objects.indexOf(bind), active]);
    return { tracker, changes };
};

describe("createBindTracker", () => {
    it("activates a bind once all its keys are held, in any order", () => {
        const { tracker, changes } = setup(["Control", "KeyM"]);
        tracker.press("KeyM", 50);
        tracker.press("Control", CTRL_LEFT);
        tracker.release("KeyM", 50);
        expect(changes()).toEqual([
            [0, true],
            [0, false]
        ]);
    });

    it("ignores key repeat", () => {
        const { tracker, changes } = setup(["KeyV"]);
        tracker.press("KeyV", 47);
        tracker.press("KeyV", 47);
        expect(changes()).toEqual([[0, true]]);
    });

    it("keeps a merged modifier held until both physical keys are released", () => {
        const { tracker, changes } = setup(["Control"]);
        tracker.press("Control", CTRL_LEFT);
        tracker.press("Control", CTRL_RIGHT);
        tracker.release("Control", CTRL_LEFT);
        expect(changes()).toEqual([[0, true]]);

        tracker.release("Control", CTRL_RIGHT);
        expect(changes()).toEqual([
            [0, true],
            [0, false]
        ]);
    });

    it("releases a key outright, for missed modifier releases", () => {
        const { tracker, changes } = setup(["Control"]);
        tracker.press("Control", CTRL_LEFT);
        tracker.press("Control", CTRL_RIGHT);
        tracker.releaseKey("Control");
        expect(changes()).toEqual([
            [0, true],
            [0, false]
        ]);
        expect(tracker.isHeld("Control")).toBe(false);
    });

    it("releases held binds when the binds change", () => {
        const { tracker, changes } = setup(["Mouse4"]);
        tracker.press("Mouse4", "Mouse4");
        tracker.setBinds([]);
        expect(changes()).toEqual([
            [0, true],
            [0, false]
        ]);
    });
});
