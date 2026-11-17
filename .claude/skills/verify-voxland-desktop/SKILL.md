---
name: verify-voxland-desktop
description: Use when proving a voxland-desktop (Vesktop fork) change in the real Electron app on a Linux desktop: launch a dev build with an isolated, logged-in profile, drive the Discord page over CDP, and capture screenshots plus PipeWire state. Covers the screen-share picker and venmic audio.
---

# Verify voxland-desktop

The app is an Electron shell around discord.com. Screen share on Wayland goes through xdg-desktop-portal-hyprland, so it runs in a desktop session with a portal and PipeWire, not in a headless container.

## Rules

- Drive the picker and audio routing from fixtures. `Vesktop.Components.ScreenShare.openScreenSharePicker(screens, true, target)` renders the picker, and `VesktopNative.virtmic.start(request)` links audio. Neither makes a portal request.
- A real share makes two or three portal requests (thumbnail, capture start, sometimes a renegotiation), and each can open the compositor's share picker. Run one only when the person at the desktop expects it, and kill any `hyprland-preview-share-picker` the run spawned (`pgrep -a -x hyprland-previe`).
- If a share request is cancelled, do not retry it. Run `stop.sh`.

## Launch

```bash
.claude/skills/verify-voxland-desktop/launch.sh   # builds dev, prints "ready: pid …, cdp 9447, log …"
```

On Hyprland it moves the dev window to the `special:voxverify` workspace. Extra arguments go to Electron. `VOXLAND_REPO=<worktree>` builds and runs another checkout; `VOXLAND_VERIFY_DIR` gives it its own profile dir.

On first launch it copies `~/.config/vesktop` into `$VOXLAND_VERIFY_DIR/config` and points `XDG_CONFIG_HOME` at the copy, so the dev build starts logged in and runs beside an installed Vesktop. `VOXLAND_CDP_PORT` overrides port 9447.

## Doctor

```bash
curl -s localhost:${VOXLAND_CDP_PORT:-9447}/json | jq -r '.[] | select(.type=="page") | .url'   # expect https://discord.com/...
node .claude/skills/verify-voxland-desktop/cdp.mjs eval 'typeof VesktopNative'                  # expect "object"
```

## Drive

`cdp.mjs` attaches to the discord.com page:

```bash
C=.claude/skills/verify-voxland-desktop/cdp.mjs
node $C eval '<js expression, awaited>'
node $C click 'Go Live'                     # last visible button with that exact text
node $C screenshot ~/.cache/voxland-verify/evidence/x.png
```

`navigator.mediaDevices.getDisplayMedia()` called from `eval` takes the same path as Go Live: portal pick, Voxland's picker modal, venmic, and an audio track. Nothing reaches a Discord call. Feature recipes live in `features/`.

## Evidence

Write to `~/.cache/voxland-verify/evidence/`, which survives cleanup. Capture the modal before the action and the system state after it: PipeWire links (`pw-dump`, `pw-link -l`) and returned track labels. A screenshot alone does not prove audio routing.

## Cleanup

```bash
.claude/skills/verify-voxland-desktop/stop.sh --purge   # kills the process group launch.sh started; --purge deletes the copied profile (it holds a Discord token)
```
