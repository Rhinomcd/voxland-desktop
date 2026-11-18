/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface TrackedBind {
    keys: string[];
}

/**
 * Tracks which binds are fully held. Several physical keys can share a key name, like left and right Control,
 * so a name stays held until the last of its physical keys is released
 */
export function createBindTracker<B extends TrackedBind>(onChange: (bind: B, active: boolean) => void) {
    let binds: B[] = [];
    const held = new Map<string, Set<unknown>>();
    const active = new Set<B>();

    function releaseKey(key: string) {
        if (!held.delete(key)) return;

        for (const bind of active) {
            if (bind.keys.includes(key)) {
                active.delete(bind);
                onChange(bind, false);
            }
        }
    }

    function releaseAll() {
        for (const key of [...held.keys()]) releaseKey(key);
    }

    return {
        /** physicalKey tells apart keys that share a name. Repeated presses of the same physical key are ignored */
        press(key: string, physicalKey: unknown) {
            const inputs = held.get(key) ?? new Set();
            held.set(key, inputs);
            if (inputs.has(physicalKey)) return;

            inputs.add(physicalKey);
            if (inputs.size > 1) return;

            // Other keys may be held too, so push to talk keeps working while moving in a game
            for (const bind of binds) {
                if (!active.has(bind) && bind.keys.includes(key) && bind.keys.every(k => held.has(k))) {
                    active.add(bind);
                    onChange(bind, true);
                }
            }
        },
        release(key: string, physicalKey: unknown) {
            const inputs = held.get(key);
            if (inputs?.delete(physicalKey) && !inputs.size) releaseKey(key);
        },
        /** Releases a key no matter how many of its physical keys are held */
        releaseKey,
        releaseAll,
        isHeld: (key: string) => held.has(key),
        setBinds(newBinds: B[]) {
            releaseAll();
            binds = newBinds;
        }
    };
}
