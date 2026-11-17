---
name: verify-voxland-desktop
description: Use when proving a voxland-desktop (Vesktop fork) change in the real Electron app on a Linux desktop: launch a dev build with an isolated, logged-in profile, drive the Discord page over CDP, and capture screenshots plus PipeWire state. Covers the screen-share picker and venmic audio.
---

# Verify voxland-desktop

The app is an Electron shell around discord.com. Screen share on Wayland goes through xdg-desktop-portal-hyprland, so it runs in a desktop session with a portal and PipeWire, not in a headless container.

## Rules

- Drive the picker and audio routing from fixtures. `Vesktop.Components.ScreenShare.openScreenSharePicker(screens, true)` renders the picker, and `VesktopNative.virtmic` links audio. Neither makes a portal request.
- A real share makes two or three portal requests (thumbnail, capture start, sometimes a renegotiation), and each can open the compositor's share picker. Run one only when the person at the desktop expects it, and kill any `hyprland-preview-share-picker` the run spawned (`pgrep -a -x hyprland-previe`).
- If a share request is cancelled, do not retry it. Run `stop.sh`.

## Launch

```bash
.claude/skills/verify-voxland-desktop/launch.sh   # builds dev, prints "ready: pid …, cdp 9447, log …"
```

If it exits non-zero it has already stopped the instance; read the log tail it prints.

On Hyprland it creates a headless output, `voxverify`, at 20000,20000 and moves the dev window onto it, so the window renders and animates without appearing on a physical screen; `stop.sh` removes the output. Extra arguments go to Electron. `VOXLAND_REPO=<worktree>` builds and runs another checkout; `VOXLAND_VERIFY_DIR` gives it its own profile dir.

On first launch it copies `~/.config/vesktop` into `$VOXLAND_VERIFY_DIR/config` and points `XDG_CONFIG_HOME` at the copy, so the dev build starts logged in and runs beside an installed Vesktop. `VOXLAND_CDP_PORT` overrides port 9447.

## Doctor

```bash
curl -s localhost:${VOXLAND_CDP_PORT:-9447}/json | jq -r '.[] | select(.type=="page") | .url'   # expect https://discord.com/... (or canary./ptb.)
node .claude/skills/verify-voxland-desktop/cdp.mjs eval 'typeof VesktopNative'                  # expect "object"
```

## Drive

`cdp.mjs` attaches to the Discord page:

```bash
C=.claude/skills/verify-voxland-desktop/cdp.mjs
node $C eval '<js expression, awaited>'
node $C click 'Go Live'                     # last visible button with that exact text
node $C screenshot ~/.cache/voxland-verify/evidence/x.png
node $C record out.mp4 10 '<js returning {x,y,width,height}>'   # run in the background, drive from another shell
```

`navigator.mediaDevices.getDisplayMedia()` called from `eval` takes the same path as Go Live: portal pick, Voxland's picker modal, venmic, and an audio track. Nothing reaches a Discord call. Feature recipes live in `features/`, indexed in `features/README.md`.

## Evidence

Write to `~/.cache/voxland-verify/evidence/`, which survives cleanup. Capture the state before the action and the result after it. For audio routing, the result is the PipeWire links (`pw-dump`, `pw-link -l`) and the returned track labels; a screenshot alone does not prove routing. Open each PNG before claiming a visual result.

A PR that changes what the app shows embeds before and after screenshots of the same states: before from `main`, after from the PR head. Build each with `VOXLAND_REPO=<checkout> launch.sh` and shoot both with the same script so the pairs differ only by the change. A new state shows after only. A change to an interaction (opening, choosing, expanding) also links a short screen recording from `cdp.mjs record`.

Crop every screenshot and recording to the surface under change. The Discord window around it shows other people's names and messages, so it never goes into a PR.

Host the files on the `pr-assets` branch under `pr-<number>/`, named `<state>-<before|after>.png` and `<interaction>.mp4`. Embed images with `https://github.com/Rhinomcd/voxland-desktop/blob/pr-assets/pr-<number>/<file>?raw=true` and link recordings with the same URL. The PR's evidence is done once every image renders in its description.

## Cleanup

```bash
.claude/skills/verify-voxland-desktop/stop.sh --purge   # kills the process group launch.sh started and removes the headless output; --purge deletes the copied profile (it holds a Discord token)
```
