/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { basename, dirname, join } from "path";

export const DEV_APP_ID = "voxland-dev";

export interface AppIdHost {
    env: Record<string, string | undefined>;
    packaged: boolean;
    execPath: string;
    readFile(path: string): string | null;
}

// Portals look the id up like GLib does: the first <id>.desktop on the data dirs wins, and Hidden=true deletes it
export function hasDesktopFile({ env, readFile }: AppIdHost, id: string) {
    const dataHome = env.XDG_DATA_HOME || join(env.HOME ?? "", ".local/share");
    const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);

    for (const dir of [dataHome, ...dataDirs]) {
        const content = readFile(join(dir, "applications", `${id}.desktop`));
        if (content !== null) return !/^Hidden\s*=\s*true\s*$/m.test(content);
    }
    return false;
}

/**
 * The name of our .desktop file, which portals and GNOME identify us by, or null if we have none.
 * scripts/channel.sh names each channel's file after its install dir, like voxland-nightly.
 * electron-builder packages install vesktop.desktop
 */
export function pickAppId(host: AppIdHost) {
    if (host.env.FLATPAK_ID) return host.env.FLATPAK_ID;
    if (!host.packaged) return DEV_APP_ID;

    const candidates = [basename(dirname(host.execPath)), "vesktop"];
    return candidates.find(id => hasDesktopFile(host, id)) ?? null;
}
