/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { app } from "electron";
import type { XDPGlobalShortcutsEvent } from "libvesktop";
import { STATIC_DIR } from "shared/paths";

import { DEV_APP_ID, pickAppId } from "./appId";
import { IS_FLATPAK } from "./constants";

const readFile = (path: string) => {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return null;
    }
};

const APP_ID = pickAppId({ env: process.env, packaged: app.isPackaged, execPath: process.execPath, readFile });

// Portals only accept ids with a desktop file, so dev runs get a hidden one of their own instead of sharing stable's
function ensureDevDesktopFile() {
    const dir = join(process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local/share"), "applications");
    const file = join(dir, `${DEV_APP_ID}.desktop`);
    if (existsSync(file)) return;

    mkdirSync(dir, { recursive: true });
    writeFileSync(
        file,
        `[Desktop Entry]\nType=Application\nName=Voxland Dev\nExec=${process.execPath}\nNoDisplay=true\n`
    );
}

let libVesktop: typeof import("libvesktop") | null = null;

function loadLibVesktop() {
    try {
        if (!libVesktop) {
            libVesktop = require(
                join(STATIC_DIR, `dist/libvesktop-${process.arch}.node`)
            ) as typeof import("libvesktop");
            if (!IS_FLATPAK && APP_ID) {
                if (APP_ID === DEV_APP_ID) ensureDevDesktopFile();
                libVesktop.registerHostApp(APP_ID);
            }
        }
    } catch (e) {
        console.error("Failed to load libvesktop:", e);
    }

    return libVesktop;
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibVesktop()?.requestBackground(autoStart, commandLine) ?? false;
}

export function isStatusNotifierHostRegistered() {
    return loadLibVesktop()?.isStatusNotifierHostRegistered() ?? true;
}

export function createXDPGlobalShortcuts(onEvent: (...args: XDPGlobalShortcutsEvent) => void) {
    const lib = loadLibVesktop();
    if (!lib) return null;

    return new lib.XDPGlobalShortcuts(onEvent);
}

export function openGnomeAppSettings() {
    return (APP_ID && loadLibVesktop()?.openGnomeAppSettings(APP_ID)) ?? false;
}
