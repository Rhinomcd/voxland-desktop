/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Node } from "@vencord/venmic";

export interface AudioApp {
    id: string;
    label: string;
    pids: number[];
    match: Node[];
}

/** What the user picked in the compositor's share dialog, as far as we could resolve it. */
export type CaptureTarget =
    | { kind: "screen" }
    | { kind: "window"; label: string; window: SharedWindow; pids: number[] };

/** A Hyprland window; the address guards against the pid being reused after the window closes. */
export interface SharedWindow {
    pid: number;
    address: string;
}

export type AudioAppList =
    | { ok: false; isGlibCxxOutdated: boolean }
    | { ok: true; apps: AudioApp[]; hasPipewirePulse: boolean };

/** The renderer names apps by id; the main process turns them into venmic matchers. */
export type AudioRequest =
    | { kind: "none" }
    | { kind: "window"; window: SharedWindow }
    | { kind: "system"; exclude: string[] }
    | { kind: "apps"; apps: string[] };
