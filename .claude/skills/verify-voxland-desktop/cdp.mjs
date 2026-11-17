#!/usr/bin/env node
// Drives the Discord page of a dev instance started with --remote-debugging-port.
// Usage: cdp.mjs eval '<expression>'     prints the awaited JSON result
//        cdp.mjs screenshot <file.png> ['<js returning {x,y,width,height}>']   cropped to the rect when given
//        cdp.mjs click '<button text>'   clicks the last visible button with exactly that text
//        cdp.mjs record <file.mp4> <seconds> ['<js returning {x,y,width,height}>']
//            screen-records the page while another shell drives it; the optional rect is read on every frame and the
//            video is cropped to their union, so it can return null while the surface is absent
import { evaluate, send, ws } from "./client.mjs";

const [command, arg, arg2, arg3] = process.argv.slice(2);

if (command === "eval") {
    console.log(JSON.stringify(await evaluate(arg), null, 2));
} else if (command === "screenshot") {
    const rect = arg2 && (await evaluate(arg2));
    if (arg2 && !rect) throw new Error("the crop rect did not resolve; refusing to write an uncropped screenshot");
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
    let crop = null;
    const growCrop = async () => {
        const r = await evaluate(arg3).catch(() => null);
        if (!r) return;
        const right = Math.max(r.x + r.width, crop ? crop.x + crop.width : -Infinity);
        const bottom = Math.max(r.y + r.height, crop ? crop.y + crop.height : -Infinity);
        const x = Math.max(0, Math.min(r.x, crop?.x ?? Infinity));
        const y = Math.max(0, Math.min(r.y, crop?.y ?? Infinity));
        crop = { x, y, width: right - x, height: bottom - y };
    };
    const onFrame = ({ data: raw }) => {
        const msg = JSON.parse(raw);
        if (msg.method !== "Page.screencastFrame") return;
        const { data, sessionId, metadata } = msg.params;
        const file = join(frameDir, `${String(frames.length).padStart(5, "0")}.png`);
        const png = Buffer.from(data, "base64");
        writeFileSync(file, png);
        frames.push({ file, time: metadata.timestamp, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
        send("Page.screencastFrameAck", { sessionId }).catch(() => {});
        if (arg3) void growCrop();
    };
    try {
        ws.addEventListener("message", onFrame);
        await send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
        await new Promise(resolve => setTimeout(resolve, Number(arg2 ?? 10) * 1000));
        await send("Page.stopScreencast");
        ws.removeEventListener("message", onFrame);
        if (arg3) await growCrop();

        if (!frames.length) throw new Error("no frames: the page did not repaint while recording");
        if (arg3 && !crop) throw new Error("the crop rect never resolved; refusing to write an uncropped recording");
        if (crop) {
            // the rect is in CSS px; frames are device px, which differ under zoom or a scaled output
            const scale = frames[0].width / cssWidth;
            crop = { x: crop.x * scale, y: crop.y * scale, width: crop.width * scale, height: crop.height * scale };
            crop.width = Math.min(crop.width, frames[0].width - crop.x);
            crop.height = Math.min(crop.height, frames[0].height - crop.y);
            if (crop.width < 2 || crop.height < 2) throw new Error("the crop rect lies outside the page");
        }

        // frames arrive only when the page repaints, so each one is held until the next
        const list = frames
            .map((f, i) => `file '${f.file}'\nduration ${Math.max((frames[i + 1]?.time ?? f.time + 1) - f.time, 0.04)}`)
            .join("\n");
        writeFileSync(join(frameDir, "list.txt"), `${list}\nfile '${frames.at(-1).file}'\n`);
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
    throw new Error("usage: cdp.mjs eval <js> | screenshot <file> | click <text> | record <file.mp4> <seconds>");
}
ws.close();
