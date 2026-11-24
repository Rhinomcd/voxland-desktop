/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { access } from "fs/promises";
import { join } from "path";

import { BrowserWindow, dialog, OpenDialogOptions } from "electron";

import { State } from "../settings";

const MOD_FILES = [
    "vencordDesktopMain.js",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.js",
    "vencordDesktopRenderer.css"
];

export async function isValidVencordInstall(dir: string) {
    if (!dir) return false;
    const results = await Promise.allSettled(MOD_FILES.map(f => access(join(dir, f))));
    return results.every(r => r.status === "fulfilled");
}

export async function pickVencordDir(parent?: BrowserWindow) {
    const options: OpenDialogOptions = { title: "Choose the Voxland mod folder", properties: ["openDirectory"] };
    const res = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    if (!res.filePaths.length) return "cancelled";

    const dir = res.filePaths[0];
    if (!(await isValidVencordInstall(dir))) return "invalid";

    State.store.vencordDir = dir;
    return "ok";
}
