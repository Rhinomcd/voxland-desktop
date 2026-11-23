/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { access } from "fs/promises";
import { join } from "path";

const MOD_FILES = [
    "vencordDesktopMain.js",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.js",
    "vencordDesktopRenderer.css"
];

export async function isValidVencordInstall(dir: string) {
    const results = await Promise.allSettled(MOD_FILES.map(f => access(join(dir, f))));
    return results.every(r => r.status === "fulfilled");
}
