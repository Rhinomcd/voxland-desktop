# Screen share audio (Linux)

Before Go Live, the picker modal shows an "Audio" summary. When you share a window, it auto-selects that window's app. When you share a whole screen, it selects all system audio except Discord. "Change" opens the manual override.

## Sub-features

- Window share: the picked window resolves to an app, which supplies its audio.
- Screen share: all system audio, minus our own processes.
- Manual override: "Share audio from" and "Leave out" dropdowns, plus Audio Settings.
- The source list refreshes every 2s while the modal is open.

## How to get to it (user POV)

Join a voice channel, click Share Screen, pick a window or screen in the portal dialog, and review the Voxland modal.

## Driving it with cdp.mjs

Render a picker state from a fixture (no portal request):

```bash
C=.claude/skills/verify-voxland-desktop/cdp.mjs
node $C eval 'void Vesktop.Components.ScreenShare.openScreenSharePicker([{ id: "window:1:0", name: "Game", url: "" }], true, { kind: "window", label: "Game", window: { pid: 1234, address: "0x1" }, pids: [1234] }); 0'
sleep 3
node $C eval 'document.querySelector("[role=dialog]").innerText'   # Audio row: the window's app and "From the window you're sharing"
```

Targets: `{ kind: "window", ... }`, `{ kind: "screen" }`, or `null` (unknown, shows "Choose audio").

All five states at once, cropped to the modal: `node .claude/skills/verify-voxland-desktop/picker-shots.mjs <outDir> '<title of a window that plays audio>'`.

Record the override opening, cropped to the modal:

```bash
MODAL='(() => { const t = [...document.querySelectorAll("[role=dialog] h1")].find(h => h.textContent.trim() === "Screen Share Picker"); const r = t.closest("[class*=\"container_\"][class*=\"size-\"]").getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; })()'
node $C record override.mp4 10 "$MODAL" &
node $C eval 'void Vesktop.Components.ScreenShare.openScreenSharePicker([{ id: "window:1:0", name: "Game", url: "" }], true, { kind: "screen" }); 0'
sleep 2; node $C click Change; wait
```

Drive routing directly with a real window from `hyprctl clients -j`:

```bash
W=$(hyprctl clients -j | jq -c '.[] | select(.title=="<window title>") | {pid, address}')
node $C eval "VesktopNative.virtmic.start({ kind: 'window', window: $W })"
node $C eval "VesktopNative.virtmic.start({ kind: 'system', exclude: ['<app id from VesktopNative.virtmic.list()>'] })"
node $C eval 'VesktopNative.virtmic.stop()'
```

Prove the routing by listing the nodes linked into this instance's mic. The app log prints the mic's receiver id (`create_mic ... receiver: <id>`), and venmic names its loopbacks `venmic-loopback-capture-<src>-<receiver>`. Map each linked source node to a PID through its `client.id` (`pw-dump`), then check that PID with `hyprctl clients -j`.

## Gotchas

- Window matching in a real share needs `scripts/linux/voxland-record-share-pick` in the xdph picker's stdout pipe (see the README). Without it, window shares default to no audio.
- Java/ALSA apps put no PID on their nodes; the PID comes from the PipeWire client that owns them.
- Every running Vesktop instance has its own venmic mic, each with a different receiver id.
