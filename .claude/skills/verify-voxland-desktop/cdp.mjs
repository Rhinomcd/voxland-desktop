#!/usr/bin/env node
// Drives the Discord page of a dev instance started with --remote-debugging-port.
// Usage: cdp.mjs eval '<expression>'     prints the awaited JSON result
//        cdp.mjs screenshot <file.png> ['<rect>']   cropped to the rect when given
//        cdp.mjs click '<button text>'   clicks the last visible button with exactly that text
//        cdp.mjs record <file.mp4> <seconds> ['<rect>']
//            screen-records the page while another shell drives it. With a rect, the page samples it before every
//            paint, each frame keeps only the area the rect covered in every sample around that frame's timestamp,
//            and the rest of the frame, or all of it when the rect was absent, is black.
// A rect is one synchronous JS expression yielding {x,y,width,height} in CSS px or a DOMRect.
import { evaluate, send, ws } from "./client.mjs";

const [command, arg, arg2, arg3] = process.argv.slice(2);

// Clipped to the viewport; null when nothing of it is visible. Reads fields directly because a DOMRect's are getters,
// which returnByValue would drop.
const rectSource = expression => `(() => {
    const r = (${expression});
    if (!r) return null;
    const x = Math.max(r.x, 0), y = Math.max(r.y, 0);
    const width = Math.min(r.x + r.width, innerWidth) - x, height = Math.min(r.y + r.height, innerHeight) - y;
    return Number.isFinite(x) && Number.isFinite(y) && width >= 1 && height >= 1 ? { x, y, width, height, viewport: innerWidth } : null;
})()`;

if (command === "eval") {
    console.log(JSON.stringify(await evaluate(arg), null, 2));
} else if (command === "screenshot") {
    const rect = arg2 && (await evaluate(rectSource(arg2)));
    if (arg2 && !rect) throw new Error("the crop rect did not resolve to a visible area; refusing to write an uncropped screenshot");
    const clip = rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    const { data } = await send("Page.captureScreenshot", { format: "png", ...(clip && { clip }) });
    if (rect) {
        const after = await evaluate(rectSource(arg2));
        const same = after && ["x", "y", "width", "height"].every(k => Math.abs(after[k] - rect[k]) < 0.5);
        if (!same) throw new Error("the surface moved or closed during the screenshot; nothing was written");
    }
    (await import("fs")).writeFileSync(arg, Buffer.from(data, "base64"));
    console.log(arg);
} else if (command === "click") {
    const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button, [role=button]")]
            .filter(b => b.textContent.trim() === ${JSON.stringify(arg)} && b.checkVisibility());
        buttons.at(-1)?.click();
        return buttons.length;
    })()`);
    if (!clicked) throw new Error(`no visible button "${arg}"`);
    console.log(`clicked "${arg}"`);
} else if (command === "record") {
    const seconds = Number(arg2 ?? 10);
    if (!(seconds > 0)) throw new Error("usage: cdp.mjs record <file.mp4> <seconds> [rect]");
    await record(arg, seconds, arg3);
} else {
    throw new Error("usage: cdp.mjs eval <js> | screenshot <file> [rect] | click <text> | record <file.mp4> <seconds> [rect]");
}
ws.close();

async function record(file, seconds, rectExpression) {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { execFileSync } = await import("child_process");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);

    const key = `__voxlandRectSamples_${process.pid}_${Date.now()}`;
    if (rectExpression) {
        await evaluate(rectSource(rectExpression)); // surfaces a broken expression before recording
        // a tick element repaints every frame, so a still surface keeps producing frames that can show it; samples use
        // Date.now(), the clock behind screencast timestamps
        await evaluate(`(() => {
            const samples = (window.${key} = []);
            const tick = document.body.appendChild(document.createElement("div"));
            tick.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647";
            const sample = () => {
                if (window.${key} !== samples) return tick.remove();
                tick.style.background = samples.length % 2 ? "rgba(0,0,0,.01)" : "rgba(0,0,0,.02)";
                let rect = null;
                try { rect = ${rectSource(rectExpression)}; } catch {}
                samples.push({ time: Date.now() / 1000, rect });
                requestAnimationFrame(sample);
            };
            sample();
        })()`);
    }
    const stopSampling = () => (rectExpression ? evaluate(`delete window.${key}`).catch(() => {}) : null);

    const frameDir = mkdtempSync(join(tmpdir(), "cdp-record-"));
    const cleanUp = () => Promise.resolve(stopSampling()).then(() => rmSync(frameDir, { recursive: true, force: true }));
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => cleanUp().then(() => process.exit(1)));
    const frames = [];
    let frameError = null;
    // a throw inside a socket listener would kill the process before any cleanup, so it is held until the capture ends
    const onFrame = ({ data: raw }) => {
        const msg = JSON.parse(raw);
        if (msg.method !== "Page.screencastFrame" || frameError) return;
        const { data, sessionId, metadata } = msg.params;
        try {
            const png = Buffer.from(data, "base64");
            const path = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
            writeFileSync(path, png);
            frames.push({ path, time: metadata.timestamp, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
        } catch (error) {
            frameError = error;
        }
        send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    };
    try {
        ws.addEventListener("message", onFrame);
        const startTime = Date.now() / 1000;
        await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        ws.removeEventListener("message", onFrame);
        const stopTime = Date.now() / 1000;
        await send("Page.stopScreencast");
        if (frameError) throw frameError;
        const samples = rectExpression ? await evaluate(`window.${key}`).catch(() => null) : null;
        await stopSampling();
        if (rectExpression && !Array.isArray(samples)) throw new Error("the rect samples were lost (the page reloaded?); refusing to write an unmasked recording");
        if (!frames.length) throw new Error("no frames: the page did not repaint while recording");

        for (const [i, f] of frames.entries()) {
            // each frame is held until the next; the first can carry the time of a paint from before the recording
            f.duration = Math.max((frames[i + 1]?.time ?? stopTime) - Math.max(f.time, startTime), 0.001);
            f.box = samples ? coveredBox(samples, f) : { x: 0, y: 0, width: f.width, height: f.height };
        }
        const shown = frames.filter(f => f.box);
        if (!shown.length) throw new Error("the crop rect never resolved; refusing to write an uncropped recording");

        let size = `${frames[0].width}:${frames[0].height}`;
        if (samples) {
            // each frame is cut to its own box and padded to the union, so nothing outside the surface is ever shown
            const union = {
                x: Math.min(...shown.map(f => f.box.x)),
                y: Math.min(...shown.map(f => f.box.y)),
                right: Math.max(...shown.map(f => f.box.x + f.box.width)),
                bottom: Math.max(...shown.map(f => f.box.y + f.box.height))
            };
            size = `${union.right - union.x}:${union.bottom - union.y}`;
            for (const f of frames) {
                const masked = f.path.replace(/\.png$/, "-masked.png");
                const filter = f.box
                    ? `crop=${f.box.width}:${f.box.height}:${f.box.x}:${f.box.y},pad=${size}:${f.box.x - union.x}:${f.box.y - union.y}:black`
                    : `crop=1:1:0:0,scale=${size},drawbox=t=fill:c=black`;
                ffmpeg("-i", f.path, "-vf", filter, masked);
                f.path = masked;
            }
        }

        // concat drops the last entry's duration without a trailing repeat and plays it twice with one, so repeat and cut
        const list = frames.map(f => `file '${f.path}'\nduration ${f.duration}`).join("\n");
        writeFileSync(join(frameDir, "list.txt"), `${list}\nfile '${frames.at(-1).path}'\n`);
        const total = frames.reduce((sum, f) => sum + f.duration, 0);
        ffmpeg("-f", "concat", "-safe", "0", "-i", join(frameDir, "list.txt"), "-vf", `fps=30,scale=${size},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, "-c:v", "libx264", "-t", String(total), file);
        console.log(`${file} (${frames.length} frames, ${frames.length - shown.length} blacked out)`);
    } finally {
        await cleanUp();
    }
}

// The area the surface covered in every rect sample within `skew` of the frame's timestamp, in that frame's device px,
// rounded inward. Null unless samples bracket the frame on both sides (a long task or clock jump leaves it unbracketed),
// the surface is in all of them, and the overlap is at least 2px.
function coveredBox(samples, frame, skew = 0.05) {
    const near = samples.filter(s => Math.abs(s.time - frame.time) <= skew);
    const bracketed = near.some(s => s.time <= frame.time) && near.some(s => s.time >= frame.time);
    if (!bracketed || near.some(s => !s.rect)) return null;
    const scaled = near.map(({ rect }) => {
        const scale = frame.width / rect.viewport;
        return { x: rect.x * scale, y: rect.y * scale, right: (rect.x + rect.width) * scale, bottom: (rect.y + rect.height) * scale };
    });
    const x = Math.ceil(Math.max(...scaled.map(r => r.x)));
    const y = Math.ceil(Math.max(...scaled.map(r => r.y)));
    const right = Math.min(Math.floor(Math.min(...scaled.map(r => r.right))), frame.width);
    const bottom = Math.min(Math.floor(Math.min(...scaled.map(r => r.bottom))), frame.height);
    return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
}
