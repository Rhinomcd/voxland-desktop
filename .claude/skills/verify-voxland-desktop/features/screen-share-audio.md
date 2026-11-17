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

```bash
C=.claude/skills/verify-voxland-desktop/cdp.mjs
echo "RuneLite - RhinoMcD" >> ~/.local/state/obs-runescape/pick-queue   # any exact window title
node $C eval 'void navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(s => (window.__s = s, window.__r = s.getTracks().map(t => t.kind + ":" + t.label))); 0'
sleep 6
node $C eval 'document.querySelector(".vcd-screen-picker-audio-picker").innerText'   # "Audio … <app> … From the window you're sharing."
node $C click 'Go Live'; sleep 3
node $C eval 'window.__r'                                                             # includes "audio:vencord-screen-share"
```

Prove the routing by listing the nodes linked into this instance's mic. venmic names loopbacks `venmic-loopback-capture-<src>-<mic>`. The `<mic>` that appears after Go Live, and was absent before it, belongs to this instance. Map each source node to a PID through its `client.id`, then check the PID with `hyprctl clients -j`. Stop with `node $C eval 'window.__s.getTracks().forEach(t => t.stop()); VesktopNative.virtmic.stop()'`.

## Gotchas

- Window matching needs `scripts/linux/voxland-record-share-pick` in the picker's stdout pipe; Ryan's `xdph-picker` has it. Without the hook, every share falls back to all system audio.
- Java/ALSA apps (RuneLite) put no PID on their nodes; the PID comes from the PipeWire client.
- Ryan's own Vesktop also runs venmic. Its mic suffix differs from the dev instance's, so do not mix them up.
