# Voxland Desktop

Electron shell around Discord, forked from Vesktop. Tooling is Vite+ (`vp`): install with `vp install`, run package scripts with `vp run <script>`. Never call pnpm or npm directly.

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
