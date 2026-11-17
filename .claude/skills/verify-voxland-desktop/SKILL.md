---
name: verify-voxland-desktop
description: Use when proving a voxland-desktop (Vesktop fork) change in the real Electron app on main-desktop (Hyprland): launch a dev build with an isolated, logged-in profile, drive the Discord page over CDP, and capture screenshots plus PipeWire state. Covers the screen-share picker and venmic audio.
---

# Verify voxland-desktop

The app is an Electron shell around discord.com. Screen share on Wayland goes through xdg-desktop-portal-hyprland, so it must run on the host desktop, not in the test box (the box has no portal or PipeWire session).

## Rules for Ryan's desktop

- Never open the interactive portal picker. Ryan's `custom_picker_binary` is `~/.local/bin/xdph-picker`, which skips the prompt for each window title queued in `~/.local/state/obs-runescape/pick-queue`. Queue exactly one title per share request, right before the request. obs-runescape uses the same queue, so check it is empty first.
- If a share request gets cancelled, do not retry it. Run `stop.sh`.
- Sharing a whole monitor has no queue path. Ask Ryan in the thread before driving that case.

## Launch

```bash
.claude/skills/verify-voxland-desktop/launch.sh   # builds dev, prints "ready: pid …, cdp 9447, log …"
```

On first launch it copies `~/.config/vesktop` into `~/.cache/voxland-verify/config` so Discord is already logged in. `XDG_CONFIG_HOME` keeps the copy separate, so it runs beside Ryan's Vesktop. Set `VOXLAND_CDP_PORT` if 9447 is taken; grok-bot holds 9333.

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
