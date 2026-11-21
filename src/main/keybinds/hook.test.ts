/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { KeyBind } from "shared/utils/keybind";
import { describe, expect, it, vi } from "vite-plus/test";

import type { HookInput } from "./nativeHook";

const { triggerAction, hook } = vi.hoisted(() => ({
    triggerAction: vi.fn(),
    hook: { onInput: null as ((input: HookInput) => void) | null }
}));

vi.mock("electron", () => ({ systemPreferences: { isTrustedAccessibilityClient: () => true }, utilityProcess: {} }));
vi.mock("../constants", () => ({ IS_FLATPAK: false }));
vi.mock("./actions", () => ({ triggerAction, setStatus: vi.fn() }));
vi.mock("./nativeHook", () => ({
    startNativeHook: (onInput: (input: HookInput) => void) => {
        hook.onInput = onInput;
        return () => (hook.onInput = null);
    }
}));

const { setHookBinds } = await import("./hook");

const CTRL_LEFT = 29;
const CTRL_RIGHT = 3613;
const F19 = 102;

const send = (key: string, physicalKey: number, pressed: boolean, ctrlKey: boolean) =>
    hook.onInput!({ key, physicalKey, pressed, ctrlKey, shiftKey: false, altKey: false, metaKey: false });

describe("input hook", () => {
    it("keeps a bind held until every physical key sharing its name is released", () => {
        const bind: KeyBind = { id: "a", action: "pushToTalk", keys: ["Control", "F19"], enabled: true };
        setHookBinds([bind]);

        send("Control", CTRL_LEFT, true, true);
        send("Control", CTRL_RIGHT, true, true);
        send("F19", F19, true, true);
        send("Control", CTRL_LEFT, false, true);
        expect(triggerAction.mock.calls).toEqual([["pushToTalk", true, bind]]);

        send("Control", CTRL_RIGHT, false, false);
        expect(triggerAction.mock.calls).toEqual([
            ["pushToTalk", true, bind],
            ["pushToTalk", false, bind]
        ]);
    });
});
