/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { StreamPick } from "shared/screenShare";
import type { CaptureTarget } from "shared/screenShareAudio";
import { describe, expect, it } from "vite-plus/test";

import { type CapturerSource, createSourcePicker, type Host, type PickerRequest } from "./pickSource";

const linux: Host = { platform: "linux", env: {}, osRelease: "6.12.0" };
const wayland: Host = { ...linux, env: { XDG_SESSION_TYPE: "wayland" } };
const windows = (build: number): Host => ({ platform: "win32", env: {}, osRelease: `10.0.${build}` });

const discord = { frame: { top: { url: "https://discord.com/channels/@me" } } } as const;

const source = (id: string, name = id): CapturerSource => ({ id, name, thumbnail: { toDataURL: () => `data:${id}` } });
const sources = [source("screen:0:0", "Screen 1"), source("window:1:0", "Game")];

function setup(host: Host, { pick = null as StreamPick | null, target = null as CaptureTarget | null } = {}) {
    const widths: number[] = [];
    const pickerRequests: PickerRequest[] = [];
    let thumbnailDuringPick: string | undefined;

    const picker = createSourcePicker(host, {
        async getSources(width) {
            widths.push(width);
            return sources;
        },
        readCaptureTarget: async () => target,
        async openPicker(request) {
            pickerRequests.push(request);
            thumbnailDuringPick = await picker.getLargeThumbnail("window:1:0");
            return pick;
        }
    });

    return { picker, widths, pickerRequests, thumbnailDuringPick: () => thumbnailDuringPick };
}

describe("pickSource", () => {
    it("refuses other sites sharing the session (openLinksWithElectron) without listing sources", async () => {
        const { picker, widths } = setup(linux, { pick: { id: "window:1:0", audio: false } });

        for (const url of [
            "https://example.com/",
            "http://discord.com/",
            "https://discord.com.evil.test/",
            "about:blank"
        ]) {
            expect(await picker.pickSource({ frame: { top: { url } } })).toBeNull();
        }
        expect(await picker.pickSource({ frame: { top: null } })).toBeNull();
        expect(await picker.pickSource({ frame: null })).toBeNull();
        expect(widths).toEqual([]);
    });

    it("default: shows every source in the picker and shares the chosen one", async () => {
        const { picker, widths, pickerRequests } = setup(linux, { pick: { id: "window:1:0", audio: true } });

        expect(await picker.pickSource(discord)).toEqual({ video: sources[1] });
        expect(widths[0]).toBe(176);
        expect(pickerRequests).toEqual([
            {
                screens: [
                    { id: "screen:0:0", name: "Screen 1", url: "data:screen:0:0" },
                    { id: "window:1:0", name: "Game", url: "data:window:1:0" }
                ],
                skipPicker: false
            }
        ]);
    });

    it("default: shares nothing when the picker is cancelled or picks an unknown source", async () => {
        expect(await setup(linux).picker.pickSource(discord)).toBeNull();
        expect(await setup(linux, { pick: { id: "window:9:0", audio: false } }).picker.pickSource(discord)).toBeNull();
    });

    it("windows: adds loopback audio when the user asks for audio", async () => {
        const pick = { id: "screen:0:0", audio: true };

        expect(await setup(windows(19045), { pick }).picker.pickSource(discord)).toEqual({
            video: sources[0],
            audio: "loopbackWithoutChrome"
        });
        expect(await setup(windows(19044), { pick }).picker.pickSource(discord)).toEqual({
            video: sources[0],
            audio: "loopback"
        });
        expect(await setup(windows(19045), { pick: { ...pick, audio: false } }).picker.pickSource(discord)).toEqual({
            video: sources[0]
        });
    });

    it("wayland: skips the source list and names the share after the picked window", async () => {
        const target: CaptureTarget = {
            kind: "window",
            label: "Firefox",
            window: { pid: 42, address: "0x1" },
            pids: [42]
        };
        const { picker, widths, pickerRequests } = setup(wayland, { pick: { id: "screen:0:0", audio: true }, target });

        expect(await picker.pickSource(discord)).toEqual({ video: sources[0] });
        expect(widths).toEqual([1920]);
        expect(pickerRequests).toEqual([
            { screens: [{ id: "screen:0:0", name: "Firefox", url: "data:screen:0:0" }], skipPicker: true, target }
        ]);
    });

    it("wayland: detected from WAYLAND_DISPLAY too, and shares nothing when the modal is cancelled", async () => {
        const { picker, widths } = setup({ ...linux, env: { WAYLAND_DISPLAY: "wayland-1" } });

        expect(await picker.pickSource(discord)).toBeNull();
        expect(widths).toEqual([1920]);
    });

    it("shares nothing when listing sources fails", async () => {
        const picker = createSourcePicker(linux, {
            getSources: () => Promise.reject(new Error("no capturer")),
            readCaptureTarget: async () => null,
            openPicker: async () => ({ id: "screen:0:0", audio: false })
        });

        expect(await picker.pickSource(discord)).toBeNull();
    });
});

describe("getLargeThumbnail", () => {
    it("serves sources only while they are in the open picker, so the renderer cannot screenshot arbitrary windows", async () => {
        const { picker, thumbnailDuringPick } = setup(linux, { pick: { id: "window:1:0", audio: false } });

        expect(await picker.getLargeThumbnail("window:1:0")).toBeUndefined();
        await picker.pickSource(discord);
        expect(thumbnailDuringPick()).toBe("data:window:1:0");
        expect(await picker.getLargeThumbnail("window:1:0")).toBeUndefined();
    });

    it("never serves sources the Wayland portal handed over", async () => {
        const { picker, thumbnailDuringPick } = setup(wayland, { pick: { id: "screen:0:0", audio: false } });

        await picker.pickSource(discord);
        expect(thumbnailDuringPick()).toBeUndefined();
    });
});
