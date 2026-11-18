/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ShortcutAction } from "shared/utils/keybind";

/**
 * Merges presses of the same hold action from several sources (binds, the portal, the socket) into one press,
 * so releasing one source doesn't release an action another source still holds.
 * Other actions fire once per press, so each source's presses pass through
 */
export function createPressTracker(
    send: (action: ShortcutAction, pressed: boolean) => void,
    isHoldAction: (action: ShortcutAction) => boolean
) {
    const holders = new Map<ShortcutAction, Set<unknown>>();

    function press(action: ShortcutAction, source: unknown) {
        const sources = holders.get(action) ?? new Set();
        holders.set(action, sources);
        if (sources.has(source)) return;

        sources.add(source);
        if (sources.size === 1) send(action, true);
    }

    function release(action: ShortcutAction, source: unknown) {
        const sources = holders.get(action);
        if (!sources?.delete(source) || sources.size) return;

        holders.delete(action);
        send(action, false);
    }

    return {
        set(action: ShortcutAction, pressed: boolean, source: unknown) {
            if (!isHoldAction(action)) send(action, pressed);
            else if (pressed) press(action, source);
            else release(action, source);
        },
        releaseSource(source: unknown) {
            for (const [action, sources] of holders) if (sources.has(source)) release(action, source);
        }
    };
}
