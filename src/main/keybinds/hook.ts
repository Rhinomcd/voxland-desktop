/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { systemPreferences, utilityProcess } from "electron";
import { KeyBind, KeybindStatus, ShortcutAction } from "shared/utils/keybind";

import { IS_FLATPAK } from "../constants";
import { setStatus, triggerAction } from "./actions";
import { createBindTracker } from "./bindTracker";
import { HookInput, HookMessage, startNativeHook } from "./nativeHook";

type ActiveBind = KeyBind & { action: ShortcutAction };

const MODIFIER_FLAGS = {
    Control: "ctrlKey",
    Shift: "shiftKey",
    Alt: "altKey",
    Meta: "metaKey"
} as const;

let stopInput: (() => void) | null = null;
// Each bind presses its action as its own source, so two binds for one action don't release each other
const tracker = createBindTracker<ActiveBind>((bind, active) => triggerAction(bind.action, active, bind));

function onInput(input: HookInput) {
    const { key, physicalKey, pressed } = input;

    // A modifier release can be missed, e.g. when the lock screen grabs input.
    for (const [modifier, flag] of Object.entries(MODIFIER_FLAGS)) {
        if (modifier !== key && tracker.isHeld(modifier) && !input[flag]) {
            tracker.releaseKey(modifier);
        }
    }

    if (key) {
        if (pressed) {
            tracker.press(key, physicalKey);
        } else {
            tracker.release(key, physicalKey);
        }
    }
}

function hookError(message: string) {
    console.error("Failed to start input hook:", message);
    return { error: `Failed to listen to input: ${message}` };
}

function startFlatpakHook() {
    // libuiohook can deadlock with Zypak's host preload during dlopen.
    const child = utilityProcess.fork(join(__dirname, "hookProcess.js"), [], {
        serviceName: "Vesktop Global Keybinds"
    });

    function fail(message: string) {
        stopHook();
        setStatus(hookError(message));
    }

    const timeout = setTimeout(() => fail("Input hook startup timed out"), 5000);
    function stop() {
        clearTimeout(timeout);
        child.kill();
    }

    child.once("spawn", () => {
        if (stopInput !== stop) {
            child.kill();
        }
    });

    child.on("message", (message: HookMessage) => {
        if (stopInput !== stop) {
            return;
        }

        switch (message.type) {
            case "ready":
                clearTimeout(timeout);
                break;
            case "input":
                onInput(message.input);
                break;
            case "error":
                fail(message.message);
                break;
        }
    });

    child.on("exit", code => {
        if (stopInput === stop) {
            fail(`Input hook process exited (code ${code})`);
        }
    });

    return stop;
}

export function stopHook() {
    tracker.releaseAll();
    const stop = stopInput;
    stopInput = null;
    stop?.();
}

/** Listens for the given binds, only running the input hook while there are any */
export function setHookBinds(newBinds: KeyBind[]): Omit<KeybindStatus, "backend"> {
    const binds = newBinds.filter((b): b is ActiveBind => b.enabled && b.action !== "unassigned" && b.keys.length > 0);
    tracker.setBinds(binds);

    if (!binds.length) {
        stopHook();
        return {};
    }

    if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(false)) {
        stopHook();
        return { needsPermission: true };
    }

    try {
        stopInput ??= IS_FLATPAK ? startFlatpakHook() : startNativeHook(onInput);
        return {};
    } catch (error) {
        return hookError(error instanceof Error ? error.message : String(error));
    }
}
