# Voxland Desktop

Electron shell around Discord, forked from Vesktop. Tooling is Vite+ (`vp`): install with `vp install`, run package scripts with `vp run <script>`. Never call pnpm or npm directly.

## Branches and release channels

`dev` is the default branch and the nightly channel; open PRs against it. `main` is the stable channel and only moves by a `dev` → `main` PR. The mod repo (`Rhinomcd/voxland`) uses the same branches.

`scripts/channel.sh` builds a channel from GitHub and installs it for the current user. There is no CI build yet, so this is how both channels ship:

- `scripts/channel.sh install stable` builds `main` of both repos into `~/.local/opt/voxland` (launcher "Voxland", profile `~/.config/vesktop`).
- `scripts/channel.sh install nightly` builds `dev` into `~/.local/opt/voxland-nightly` (launcher "Voxland Nightly", profile `~/.local/share/voxland/nightly/profile`).
- `scripts/channel.sh timer` copies the script to `~/.local/bin/voxland-channel` and adds a systemd user timer that rebuilds nightly at 04:00. Each stable install refreshes that copy from `main`.

A channel whose app is running is left alone, and an install with nothing new on either branch is a no-op. Pass `--force` to rebuild anyway. Checkouts and the built mod live in `~/.local/share/voxland/<channel>/`.

## Checks

`vp run test` is what CI runs: lint, format check, typecheck, then unit tests. Run it before opening a PR.

## Unit tests

- Runner: Vitest through Vite+. `vp test` runs the unit tests once; `vp test watch` reruns on change; `vp test src/shared` runs one directory.
- Put a test next to the code it covers as `<name>.test.ts` under `src/`. Import test APIs from `vite-plus/test`, not `vitest`.
- Imports resolve like app code, so `shared/...` and `main/...` work.
- Tests run in Node without Electron. Test logic that takes its inputs as arguments; pass fakes rather than importing modules that touch Electron or the filesystem at load time.
- Test behaviour through the public API, as in `src/shared/utils/SettingsStore.test.ts`.

## Proving changes in the app

`.claude/skills/verify-voxland-desktop/SKILL.md` launches a dev build with an isolated profile and drives it over CDP.
