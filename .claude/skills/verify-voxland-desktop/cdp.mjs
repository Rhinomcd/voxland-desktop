#!/usr/bin/env node
// Drives the Discord page of a dev instance started with --remote-debugging-port.
// Usage: cdp.mjs eval '<expression>'     prints the awaited JSON result
//        cdp.mjs screenshot <file.png> ['<js returning a rect>']   cropped to the rect when given
//        cdp.mjs click '<button text>'   clicks the last visible button with exactly that text
//        cdp.mjs record <file.mp4> <seconds> ['<js returning a rect>']
//            screen-records the page while another shell drives it; the optional rect is read on every frame, frames
//            where it is null or empty are dropped, and the video is cropped to the union of the rest
// A rect is {x,y,width,height} in CSS px or a DOMRect.
import { evaluate, send, ws } from "./client.mjs";

const [command, arg, arg2, arg3] = process.argv.slice(2);

// A rect expression is one JS expression yielding {x,y,width,height} in CSS px or a DOMRect (whose fields are getters,
// which returnByValue would drop). The result is clipped to the viewport; null means nothing of it is visible.
async function readRect(expression) {
    const r = await evaluate(`(async () => {
        const r = await (${expression});
        if (!r) return null;
        const x = Math.max(r.x, 0), y = Math.max(r.y, 0);
        return { x, y, width: Math.min(r.x + r.width, innerWidth) - x, height: Math.min(r.y + r.height, innerHeight) - y };
    })()`);
    return r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.height > 0 ? r : null;
}

// The surface's area while a frame painted, in that frame's device px (scale = device px per CSS px): the frame painted between the rect samples
// before and after it, so only their overlap was covered for the whole time. Rounds inward; null if under 2px.
function visibleBox(before, after, frame, scale) {
    if (!before || !after) return null;
    const x = Math.ceil(Math.max(before.x, after.x) * scale);
    const y = Math.ceil(Math.max(before.y, after.y) * scale);
    const right = Math.min(Math.floor(Math.min(before.x + before.width, after.x + after.width) * scale), frame.width);
    const bottom = Math.min(Math.floor(Math.min(before.y + before.height, after.y + after.height) * scale), frame.height);
    return right - x >= 2 && bottom - y >= 2 ? { x, y, width: right - x, height: bottom - y } : null;
}

if (command === "eval") {
    console.log(JSON.stringify(await evaluate(arg), null, 2));
} else if (command === "screenshot") {
    const rect = arg2 && (await readRect(arg2));
    if (arg2 && !rect) throw new Error("the crop rect did not resolve to a visible area; refusing to write an uncropped screenshot");
    const { data } = await send("Page.captureScreenshot", { format: "png", ...(rect && { clip: { ...rect, scale: 1 } }) });
    (await import("fs")).writeFileSync(arg, Buffer.from(data, "base64"));
    console.log(arg);
} else if (command === "click") {
    const clicked = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll("button, [role=button]")]
            .filter(b => b.textContent.trim() === ${JSON.stringify(arg)} && b.offsetParent);
        buttons.at(-1)?.click();
        return buttons.length;
    })()`);
    if (!clicked) throw new Error(`no visible button "${arg}"`);
    console.log(`clicked "${arg}"`);
} else if (command === "record") {
    const { mkdtempSync, writeFileSync, rmSync } = await import("fs");
    const { execFileSync } = await import("child_process");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    const cssWidth = await evaluate("innerWidth");
    const sampleRect = () => (arg3 ? readRect(arg3).catch(() => null) : null);
    const firstSample = await sampleRect();
    const frameDir = mkdtempSync(join(tmpdir(), "cdp-record-"));
    const frames = [];
    const onFrame = ({ data: raw }) => {
        const msg = JSON.parse(raw);
        if (msg.method !== "Page.screencastFrame") return;
        const { data, sessionId, metadata } = msg.params;
        const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
        const png = Buffer.from(data, "base64");
        writeFileSync(file, png);
        frames.push({ file, time: metadata.timestamp, width: png.readUInt32BE(16), height: png.readUInt32BE(20), rect: sampleRect() });
        send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    };
    try {
        ws.addEventListener("message", onFrame);
        await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
        await new Promise(resolve => setTimeout(resolve, Number(arg2 ?? 10) * 1000));
        ws.removeEventListener("message", onFrame);
        const stopTime = Date.now() / 1000;
        await send("Page.stopScreencast");
        if (!frames.length) throw new Error("no frames: the page did not repaint while recording");

        let previous = firstSample;
        for (const [i, f] of frames.entries()) {
            // frames arrive only when the page repaints, so each one is held until the next
            f.duration = Math.max((frames[i + 1]?.time ?? stopTime) - f.time, 0.001);
            const sample = await f.rect;
            f.box = arg3 ? visibleBox(previous, sample, f, f.width / cssWidth) : { x: 0, y: 0, width: f.width, height: f.height };
            previous = sample;
        }
        const kept = frames.filter(f => f.box);
        if (!kept.length) throw new Error("the crop rect never resolved; refusing to write an uncropped recording");

        // every frame is cut to its own box and padded to the union, so nothing outside the surface is ever shown
        const union = {
            x: Math.min(...kept.map(f => f.box.x)),
            y: Math.min(...kept.map(f => f.box.y)),
            right: Math.max(...kept.map(f => f.box.x + f.box.width)),
            bottom: Math.max(...kept.map(f => f.box.y + f.box.height))
        };
        for (const f of kept) {
            const { x, y, width, height } = f.box;
            const masked = f.file.replace(/\.png$/, "-masked.png");
            const pad = `pad=${union.right - union.x}:${union.bottom - union.y}:${x - union.x}:${y - union.y}:black`;
            execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", f.file, "-vf", `crop=${width}:${height}:${x}:${y},${pad}`, masked]);
            f.file = masked;
        }

        const list = kept.map(f => `file '${f.file}'\nduration ${f.duration}`).join("\n");
        writeFileSync(join(frameDir, "list.txt"), `${list}\nfile '${kept.at(-1).file}'\n`);
        execFileSync("ffmpeg", [
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            join(frameDir, "list.txt"),
            "-vf",
            "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
            "-c:v",
            "libx264",
            arg
        ]);
    } finally {
        rmSync(frameDir, { recursive: true, force: true });
    }
    console.log(`${arg} (${frames.length} frames)`);
} else {
    throw new Error("usage: cdp.mjs eval <js> | screenshot <file> [rect] | click <text> | record <file.mp4> <seconds> [rect]");
}
ws.close();
