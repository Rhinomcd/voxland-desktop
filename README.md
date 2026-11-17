# Voxland Desktop

Voxland is a Discord client mod and Linux desktop app, forked from [Vencord](https://github.com/Vendicated/Vencord) and [Vesktop](https://github.com/Vencord/Vesktop). It welcomes contributions written with AI.

## Why this exists

Discord on Linux still has rough edges, especially around streaming and screen sharing. Looking for alternatives led me to Vencord, its desktop app Vesktop, and Equicord, a fork of Vencord.

All of them are hostile to AI-assisted contributions, but none of them says clearly what is and isn't allowed. The rules [differ](https://github.com/Vendicated/Vencord/blob/e75ac9ace41f6212cfaa2d5f3670830be392da4e/CONTRIBUTING.md#ai-policy) between related repos, and some sit in places a contributor [never sees](https://github.com/Vencord/Vesktop/blob/a7a0e5d5c3a021a54aeda506e2cd3ea20d5c3efb/.github/pull_request_template.md?plain=1#L1-L4). [Similar PRs](https://github.com/Vencord/Vesktop/pull/1277#issuecomment-4826510080) get [very different treatment](https://github.com/Vencord/Vesktop/pull/1292#issuecomment-5040332173). Contributors don't get a policy. They get [mocked](https://github.com/Vencord/Vesktop/pull/1265#issuecomment-4480164228) in public review threads and [blocked without warning](https://github.com/Vendicated/Vencord/blob/e75ac9ace41f6212cfaa2d5f3670830be392da4e/.github/pull_request_template.md?plain=1#L14). [Profane](https://github.com/Vencord/Vesktop/commit/3cb2a7bc1306923b60157231430c5b4e78e531da), [hostile](https://github.com/Vencord/Vesktop/blob/a7a0e5d5c3a021a54aeda506e2cd3ea20d5c3efb/.github/pull_request_template.md?plain=1#L3) commit messages and comments are routine.

Voxland takes the opposite approach. The contribution policy is written down, including exactly how AI may be used, and the repo gives agents what they need to produce good PRs. With that in place, a community working alongside agents can ship more than a handful of maintainers can on their own.

Voxland is not affiliated with Discord, Vencord, Vesktop, or Equicord.

## Ground rules for contributors

These apply to every PR, whether a person, an agent, or both wrote it.

1. **Use AI openly.** Name the models and tools you used, for example in the PR's closing attribution line. We review the change, not who or what wrote it.
2. **A human answers for every PR.** If you opened it, you own it. You must be able to explain what it changes and why, and respond to review yourself.
3. **One problem per PR.** Split independent fixes into separate PRs, even small ones.
4. **Agree on features first.** Bug fixes can go straight to a PR. New features and changes to existing behavior start as a Discussion and need a maintainer's agreement before you build them.
5. **Show that it works.** Show how you (or better yet, your agents) reproduced the problem and checked the change, and what you saw. UI changes need before-and-after screenshots. "Tests pass" on its own is not evidence.
6. **Follow AGENTS.md.** It holds the project's conventions. Point your agent at it before it starts.
7. **Every PR gets AI review.** CodeRabbit and Macroscope review each PR. Fix or answer their findings before you ask for human review.

## What maintainers commit to

1. **A written policy that keeps evolving.** These rules are a starting point, not a rulebook set in stone. Tools and models change quickly, so we revise the policy often and in the open. When a PR shows a gap, we update the docs and explain why.
2. **We make good PRs easy to write.** The repo carries what agents need: AGENTS.md, scripts that launch and check the app, CI, and AI review. When agents keep making the same mistake, we fix the repo with a lint rule, a test, or a doc instead of blaming the contributor.
3. **A reason for every closed PR.** A closed PR gets a short explanation that names the rule it broke or the problem with the change.
4. **Blocks are a last resort.** We block accounts for harassment or repeated, deliberate spam, never for a single PR that misses the bar.
5. **Professional conduct.** We critique code, not people, in reviews, comments, and commit messages alike. Everyone else is held to the same standard.

---

# Vesktop

Vesktop is a custom Discord desktop app

**Main features**:

- Vencord preinstalled
- Much more lightweight and faster than the official Discord app
- Linux Screenshare with sound & wayland
- Much better privacy, since Discord has no access to your system

**Not yet supported**:

- Global Keybinds
- see the [Roadmap](https://github.com/Vencord/Vesktop/issues/324)

![](https://github.com/Vencord/Vesktop/assets/45497981/8608a899-96a9-4027-9725-2cb02ba189fd)
![](https://github.com/Vencord/Vesktop/assets/45497981/8701e5de-52c4-4346-a990-719cb971642e)

## Installing

Visit https://vesktop.dev/install

## Building from Source

You need to have the following dependencies installed:

- [Git](https://git-scm.com/downloads)
- [Vite+](https://viteplus.dev/guide/) (`vp`), which also manages Node.js and the package manager

Packaging will create builds in the dist/ folder

```sh
git clone https://github.com/Vencord/Vesktop
cd Vesktop

# Install Dependencies
vp install

# Either run it without packaging
vp run start

# Or package (will build packages for your OS)
vp run package

# Or only build the Linux Pacman package
vp run package --linux pacman

# Or package to a directory only
vp run package:dir
```

## Building LibVesktop from Source

This is a small C++ helper library Vesktop uses on Linux to emit D-Bus events. By default, prebuilt binaries for x64 and arm64 are used.

If you want to build it from source:

1. Install build dependencies:
    - Debian/Ubuntu: `apt install build-essential python3 curl pkg-config libglib2.0-dev`
    - Fedora: `dnf install @c-development @development-tools python3 curl pkgconf-pkg-config glib2-devel`
2. Run `vp run buildLibVesktop`
3. From now on, building Vesktop will use your own build
