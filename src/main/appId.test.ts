/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vite-plus/test";

import { type AppIdHost, DEV_APP_ID, pickAppId } from "./appId";

const ENTRY = "[Desktop Entry]\nType=Application\n";

const host = (execPath: string, files: Record<string, string>, env: AppIdHost["env"] = {}): AppIdHost => ({
    env: { HOME: "/home/u", ...env },
    packaged: true,
    execPath,
    readFile: path => files[path] ?? null
});

describe("pickAppId", () => {
    it("uses the channel install dir when its desktop file exists", () => {
        const h = host("/home/u/.local/opt/voxland-nightly/vesktop", {
            "/home/u/.local/share/applications/voxland-nightly.desktop": ENTRY
        });
        expect(pickAppId(h)).toBe("voxland-nightly");
    });

    it("falls back to vesktop.desktop for electron-builder packages", () => {
        const h = host("/opt/Vesktop/vesktop", { "/usr/share/applications/vesktop.desktop": ENTRY });
        expect(pickAppId(h)).toBe("vesktop");
    });

    it("treats a Hidden entry earlier on the data dirs as deleting the file", () => {
        const h = host("/opt/Vesktop/vesktop", {
            "/home/u/.local/share/applications/vesktop.desktop": ENTRY + "Hidden=true\n",
            "/usr/share/applications/vesktop.desktop": ENTRY
        });
        expect(pickAppId(h)).toBeNull();
    });

    it("only reads Hidden from the [Desktop Entry] group", () => {
        const h = host("/x/voxland/vesktop", {
            "/home/u/.local/share/applications/voxland.desktop": ENTRY + "\n[Desktop Action new]\nHidden=true\n"
        });
        expect(pickAppId(h)).toBe("voxland");
    });

    it("honours XDG_DATA_HOME and XDG_DATA_DIRS", () => {
        const h = host(
            "/x/voxland/vesktop",
            { "/data/applications/voxland.desktop": ENTRY },
            {
                XDG_DATA_HOME: "/nowhere",
                XDG_DATA_DIRS: "/data"
            }
        );
        expect(pickAppId(h)).toBe("voxland");
    });

    it("prefers the Flatpak id and gives dev runs their own id", () => {
        expect(pickAppId(host("/app/bin/vesktop", {}, { FLATPAK_ID: "dev.vencord.Vesktop" }))).toBe(
            "dev.vencord.Vesktop"
        );
        expect(pickAppId({ ...host("/repo/node_modules/electron/dist/electron", {}), packaged: false })).toBe(
            DEV_APP_ID
        );
    });
});
