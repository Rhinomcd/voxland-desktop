// Connects to the Discord page of a dev instance started with --remote-debugging-port.
export const port = process.env.VOXLAND_CDP_PORT ?? "9447";

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === "page" && /^https:\/\/([a-z]+\.)?discord\.com\//.test(t.url));
if (!page) throw new Error(`no Discord page on port ${port}`);

export const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
};
ws.onclose = () => pending.forEach(settle => settle({ error: { message: "CDP socket closed" } }));

export const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, msg => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
        ws.send(JSON.stringify({ id, method, params }));
    });

export async function evaluate(expression) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
}
