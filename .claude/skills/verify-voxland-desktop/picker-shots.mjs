#!/usr/bin/env node
// Renders the screen-share picker in five states from fixtures and screenshots each one. Makes no portal request.
// Usage: picker-shots.mjs <outDir> ['<title of a window that plays audio>']
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";

const port = process.env.VOXLAND_CDP_PORT ?? "9447";
const [outDir, windowTitle] = process.argv.slice(2);
if (!outDir) throw new Error("usage: picker-shots.mjs <outDir> [window title]");
mkdirSync(outDir, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === "page" && t.url.startsWith("https://discord.com"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    pending.get(m.id)?.(m);
};
const send = (method, params = {}) =>
    new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, m => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
        ws.send(JSON.stringify({ id: i, method, params }));
    });
const evaluate = async expr => {
    const r = await send("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });

const thumb = await evaluate(`(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 960, height: 540 });
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 960, 540);
    grad.addColorStop(0, "#2b3a55"); grad.addColorStop(1, "#5a4a3a");
    g.fillStyle = grad; g.fillRect(0, 0, 960, 540);
    g.fillStyle = "#e8d9a8"; g.font = "bold 48px sans-serif"; g.fillText("Game window", 330, 290);
    return c.toDataURL();
})()`);

const hyprWindow = windowTitle
    ? JSON.parse(execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8" })).find(w => w.title === windowTitle)
    : undefined;
if (windowTitle && !hyprWindow) throw new Error(`no window titled "${windowTitle}"`);
const shared = hyprWindow ?? { pid: 999999, address: "0x0", title: "Game" };
const windowTarget = {
    kind: "window",
    label: shared.title,
    window: { pid: shared.pid, address: shared.address },
    pids: [shared.pid]
};

const states = [
    { name: "1-window", label: shared.title, target: windowTarget },
    {
        name: "2-window-quiet",
        label: "Firefox",
        target: { ...windowTarget, label: "Firefox", window: { pid: 999999, address: "0x0" }, pids: [999999] }
    },
    { name: "3-screen", label: "", target: { kind: "screen" } },
    { name: "4-unknown", label: "", target: null },
    { name: "5-override-open", label: shared.title, target: windowTarget, open: true }
];

const closeAll = () =>
    evaluate(`(async () => {
    for (let i = 0; i < 5 && document.querySelector("[role=dialog]"); i++) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
    }
})()`);

await closeAll();
for (const s of states) {
    await evaluate(`void Vesktop.Components.ScreenShare.openScreenSharePicker(
        [{ id: "window:1:0", name: ${JSON.stringify(s.label)}, url: ${JSON.stringify(thumb)} }], true, ${JSON.stringify(s.target)}
    ).catch(() => {}); 0`);
    await sleep(3500); // audio list polls every 2s
    if (s.open) {
        await evaluate(
            `(() => { [...document.querySelectorAll("[role=dialog] button, [role=dialog] [role=button]")].find(b => /^(Change|Edit|Choose)/i.test(b.textContent.trim()))?.click(); })()`
        );
        await sleep(400);
        await evaluate(`(() => {
            const sel = [...document.querySelectorAll("[role=dialog] [role=button], [role=dialog] [role=combobox]")].filter(e => e.getAttribute("aria-expanded") === "false").at(0);
            for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) sel?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
        })()`);
        await sleep(800);
    }
    // grow the scroller so the whole dialog body is visible in one shot
    await evaluate(
        `(() => { const d = document.querySelector("[role=dialog]"); d.querySelectorAll("*").forEach(e => { if (e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== "visible") { e.scrollTop = e.scrollHeight; } }); })()`
    );
    await sleep(800); // let the open animation finish so the modal is opaque
    const rect = await evaluate(
        // only the modal box, so the Discord window behind it never lands in the screenshot
        `(() => {
            const title = [...document.querySelectorAll("[role=dialog] h1")].find(h => h.textContent.trim() === "Screen Share Picker");
            const r = title.closest('[class*="container_"][class*="size-"]').getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`
    );
    const pop = await evaluate(
        `(() => { const o = document.querySelector("[role=listbox]"); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
    );
    const clip = pop
        ? {
              x: Math.min(rect.x, pop.x),
              y: Math.min(rect.y, pop.y),
              width: Math.max(rect.x + rect.width, pop.x + pop.width) - Math.min(rect.x, pop.x),
              height: Math.max(rect.y + rect.height, pop.y + pop.height) - Math.min(rect.y, pop.y),
              scale: 1
          }
        : { ...rect, scale: 1 };
    const { data } = await send("Page.captureScreenshot", { format: "png", clip });
    writeFileSync(`${outDir}/${s.name}.png`, Buffer.from(data, "base64"));
    writeFileSync(`${outDir}/${s.name}.txt`, await evaluate(`document.querySelector("[role=dialog]").innerText`));
    console.log(s.name);
    await closeAll();
}
await send("Emulation.clearDeviceMetricsOverride");
ws.close();
