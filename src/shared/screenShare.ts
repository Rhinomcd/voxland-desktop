/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AudioRequest } from "./screenShareAudio";

/** What the screen-share picker returns to the main process. */
export interface StreamPick {
    id: string;
    audio: boolean;
    contentHint?: string;
    /** Only set on Linux, where audio comes from the virtual mic. */
    audioRequest?: AudioRequest;
}
