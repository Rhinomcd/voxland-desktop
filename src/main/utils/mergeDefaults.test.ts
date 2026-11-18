/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DefaultVesktopSettings } from "shared/defaultSettings";
import type { Settings } from "shared/settings";
import { describe, expect, it } from "vite-plus/test";

import { mergeDefaults } from "./mergeDefaults";

describe("mergeDefaults", () => {
    it("fills missing keys from the defaults", () => {
        const settings = mergeDefaults({} as Settings, DefaultVesktopSettings);

        expect(settings).toEqual(DefaultVesktopSettings);
    });

    it("keeps stored values, including falsy ones", () => {
        const stored = { tray: false, discordBranch: "canary" } as Settings;

        const settings = mergeDefaults(stored, DefaultVesktopSettings);

        expect(settings).toBe(stored);
        expect(settings).toMatchObject({ tray: false, discordBranch: "canary", appBadge: true });
    });

    it("merges nested objects key by key", () => {
        type Nested = { audio: { device?: string; volume?: number; filters?: string[] } };
        const defaults: Nested = { audio: { device: "default", volume: 100, filters: ["noise"] } };

        const settings = mergeDefaults<Nested>({ audio: { volume: 50, filters: [] } }, defaults);

        expect(settings).toEqual({ audio: { device: "default", volume: 50, filters: [] } });
    });
});
