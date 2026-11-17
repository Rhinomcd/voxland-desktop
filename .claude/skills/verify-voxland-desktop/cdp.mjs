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

// accepts a DOMRect (its fields are getters, which returnByValue drops) and rejects anything without a visible area
async function readRect(expression) {
    const r = await evaluate(
        `(async () => { const r = await (${expression}); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
    ).catch(() => null);
    return r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.width > 0 && r.height > 0 ? r : null;
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
    const frameDir = mkdtempSync(join(tmpdir(), "cdp-record-"));
    const frames = [];
    const onFrame = ({ data: raw }) => {
        const msg = JSON.parse(raw);
        if (msg.method !== "Page.screencastFrame") return;
        const { data, sessionId, metadata } = msg.params;
        const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
        const png = Buffer.from(data, "base64");
        writeFileSync(file, png);
        const rect = arg3 ? readRect(arg3) : null;
        frames.push({ file, time: metadata.timestamp, width: png.readUInt32BE(16), height: png.readUInt32BE(20), rect });
        send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    };
    try {
        ws.addEventListener("message", onFrame);
        await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
        await new Promise(resolve => setTimeout(resolve, Number(arg2 ?? 10) * 1000));
        await send("Page.stopScreencast");
        const stopTime = Date.now() / 1000;
        ws.removeEventListener("message", onFrame);

        // frames arrive only when the page repaints, so each one is held until the next
        for (const [i, f] of frames.entries()) {
            f.rect = await f.rect;
            f.duration = Math.max((frames[i + 1]?.time ?? stopTime) - f.time, 0.001);
        }
        // a frame painted while the surface was absent shows only what lies behind it
        const kept = arg3 ? frames.filter(f => f.rect) : frames;
        if (!frames.length) throw new Error("no frames: the page did not repaint while recording");
        if (!kept.length) throw new Error("the crop rect never resolved; refusing to write an uncropped recording");

        let crop = null;
        if (arg3) {
            const left = Math.max(0, Math.min(...kept.map(f => f.rect.x)));
            const top = Math.max(0, Math.min(...kept.map(f => f.rect.y)));
            const right = Math.max(...kept.map(f => f.rect.x + f.rect.width));
            const bottom = Math.max(...kept.map(f => f.rect.y + f.rect.height));
            // the rect is in CSS px; frames are device px, which differ under zoom or a scaled output
            const scale = kept[0].width / cssWidth;
            crop = { x: left * scale, y: top * scale };
            crop.width = Math.min((right - left) * scale, kept[0].width - crop.x);
            crop.height = Math.min((bottom - top) * scale, kept[0].height - crop.y);
            if (!(crop.width >= 2 && crop.height >= 2)) throw new Error("the crop rect lies outside the page");
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
            `${crop ? `crop=${Math.round(crop.width)}:${Math.round(crop.height)}:${Math.round(crop.x)}:${Math.round(crop.y)},` : ""}fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
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
