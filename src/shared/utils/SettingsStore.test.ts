/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vite-plus/test";

import { SettingsStore } from "./SettingsStore";

type Data = { a: { b: { c: number }; d: string }; e?: boolean };

const makeStore = () => new SettingsStore<Data>({ a: { b: { c: 1 }, d: "x" } });

describe("SettingsStore", () => {
    it("notifies path listeners when a nested key changes", () => {
        const store = makeStore();
        const onC = vi.fn();
        const onD = vi.fn();
        store.addChangeListener("a.b.c", onC);
        store.addChangeListener("a.d", onD);

        store.store.a.b.c = 2;

        expect(onC).toHaveBeenCalledExactlyOnceWith(2);
        expect(onD).not.toHaveBeenCalled();
        expect(store.plain.a.b.c).toBe(2);
    });

    it("notifies global listeners with the root object and the changed path", () => {
        const store = makeStore();
        const onAny = vi.fn();
        store.addGlobalChangeListener(onAny);

        store.store.a.b.c = 2;

        expect(onAny).toHaveBeenCalledExactlyOnceWith(store.plain, "a.b.c");
    });

    it("does not notify when the value is unchanged", () => {
        const store = makeStore();
        const onAny = vi.fn();
        store.addGlobalChangeListener(onAny);

        store.store.a.b.c = 1;

        expect(onAny).not.toHaveBeenCalled();
    });

    it("notifies with undefined when a key is deleted", () => {
        const store = new SettingsStore<Data>({ a: { b: { c: 1 }, d: "x" }, e: true });
        const onE = vi.fn();
        store.addChangeListener("e", onE);

        delete store.store.e;

        expect(onE).toHaveBeenCalledExactlyOnceWith(undefined);
        expect("e" in store.plain).toBe(false);
    });

    it("stops notifying removed listeners", () => {
        const store = makeStore();
        const onC = vi.fn();
        store.addChangeListener("a.b.c", onC);
        store.removeChangeListener("a.b.c", onC);

        store.store.a.b.c = 2;

        expect(onC).not.toHaveBeenCalled();
    });

    it("setData notifies the given nested path and global listeners", () => {
        const store = makeStore();
        const onC = vi.fn();
        const onAny = vi.fn();
        store.addChangeListener("a.b.c", onC);
        store.addGlobalChangeListener(onAny);
        const next: Data = { a: { b: { c: 3 }, d: "y" } };

        store.setData(next, "a.b.c");

        expect(onC).toHaveBeenCalledExactlyOnceWith(3);
        expect(onAny).toHaveBeenCalledExactlyOnceWith(next, "");
        expect(store.store.a.d).toBe("y");
    });
});
