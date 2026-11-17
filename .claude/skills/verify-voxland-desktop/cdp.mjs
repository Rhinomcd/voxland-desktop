#!/usr/bin/env node
// Drives the Discord page of a dev instance started with --remote-debugging-port.
// Usage: cdp.mjs eval '<expression>'     prints the awaited JSON result
//        cdp.mjs screenshot <file.png>
//        cdp.mjs click '<button text>'   clicks the last visible button with exactly that text
const port = process.env.VOXLAND_CDP_PORT ?? "9447";
const [command, arg] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === "page" && t.url.startsWith("https://discord.com"));
if (!page) throw new Error(`no discord.com page on port ${port}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    pending.get(msg.id)?.(msg);
};
const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, msg => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
        ws.send(JSON.stringify({ id, method, params }));
    });

async function evaluate(expression) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
}

if (command === "eval") {
    console.log(JSON.stringify(await evaluate(arg), null, 2));
} else if (command === "screenshot") {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
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
} else {
    throw new Error("usage: cdp.mjs eval <js> | screenshot <file> | click <text>");
}
ws.close();
