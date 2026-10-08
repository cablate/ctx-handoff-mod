# Contributing

Thanks for helping. Bug reports and ideas go in [issues](https://github.com/cablate/ctx-handoff-mod/issues/new/choose); please include your Claude Code version and the output of `/handoff`.

## Code changes

You need Node 22 and a Claude Code build with mods.

1. Fork and clone the repo, then load your copy: `claude --plugin-dir /path/to/ctx-handoff`.
2. Find the code in `hooks/`: `register.ts` (hooks, commands and everything that touches session state), `notes.ts` (notes file format, memory tiers, text injected into new chats), `distill.ts` (background-distill prompt, model actions, secret check), `guards.ts` (guard types, matching, proposal checks, guard list text), `promote.ts` (picking rules, procedures and guards to move into the repo and handling the AI's report), `status.ts` (`/handoff` status text), `panel-data.ts` (panel snapshot, deleting notes), `records.ts` (types of stored records, store key cleanup), `config.ts` (settings, defaults, fixed limits), `handoff.ts` (handoff prompt), `loops.ts` (repeated-failure nudge and "done" check logic), `lang.ts` (reply-language check: what counts as prose, per-language rules, reminder text), `progress.ts` (the "where you left off" note: type, limits, the text offered to a new chat), `runtime.ts` (in-process state), `transcript.ts` (conversation to text), `paths.ts` (path helpers), `panel.tsx` (panel), `i18n.ts` (UI strings). `register.ts` stays the largest file on purpose: Claude Code only lets `$` flow into functions declared in the same file (checked when the plugin loads, so `tsc` won't catch it), so everything that calls `$` lives there and only pure functions can move out. The mod hot-reloads when you save, so open sessions pick up half-finished edits; `node tools/wt.mjs new <branch>` gives you a separate worktree to work in.
3. Add or update tests in the matching `hooks/*.test.ts` (`handoff`, `handoff-failure`, `distill`, `notes-file`, `guards`, `loops`, `progress`, `panel`, `promote`, `procedures`, `config`, `lang`, `reply-lang`; shared mocks and helpers live in `hooks/test-world.ts`, which is not a test file itself). A bug fix should come with a test that fails without it.
4. Run `node tools/check.mjs` (plugin validate, plugin test, tool tests, `tsc`, Biome lint, the bilingual docs check, and a scan for personal info in files and history). It must pass.
5. If the change is visible to users, update the docs in both languages (`README` for the overview, `docs/guide` for details), and add a line under Unreleased in both `CHANGELOG.md` and `CHANGELOG.zh-TW.md` (see [Writing docs](#writing-docs)).

## Code style

- TypeScript, ES modules, 2-space indent, single quotes, no semicolons. `.editorconfig` sets the basics for your editor.
- `tsc` in strict mode and [Biome](https://biomejs.dev) lint (rules in `biome.json`) are the checks; `node tools/check.mjs` and CI run both. Biome runs through `npx` at a fixed version, so the repo still has no npm dependencies. To run it alone: `npx @biomejs/biome@2.5.15 lint .`
- Code comments and `CLAUDE.md` are in Traditional Chinese, the maintainer's language. English comments are welcome in your changes.
- Messages people see live in `hooks/i18n.ts`, in both English and Traditional Chinese; add both when you add one. Don't prefix them with `[ctx-handoff]` (Claude Code adds the mod name).

## Writing docs

User-facing docs come in two languages: English is the source (`X.md`), Traditional Chinese follows (`X.zh-TW.md`), and each links to the other at the top. `node tools/docs.mjs check` (also in `check.mjs` and CI) fails when the two drift apart: different headings, list items, table rows, images, code blocks, links or inline code. Placeholders like `<name>` may be translated.

- **README** is the front page: banner, one-line pitch, the animated overview, why, install with a visible result, then each feature in a picture and a few lines, and links. Details (every setting, command, permission, limit, troubleshooting) go in **`docs/guide.md`**. No internal terms or design history; those live in `CLAUDE.md`.
- **Pictures** live in `docs/assets/` as animated SVGs (CSS keyframes, dark card background so they read on both GitHub themes, text in English, `aria-label` describing the animation). Check a change by screenshotting it in headless Chrome at a few points of the loop. The social preview is `docs/social-preview.html` rendered to PNG and uploaded in the repo settings.
- **CHANGELOG:** [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each version opens with one or two sentences on why it's worth upgrading, then an **Upgrading** line if users must do anything, then `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` (繁中：新增、變更、棄用、移除、修正、安全性). Each entry leads with what the user gets (**bold name:** benefit, then how, then the setting), not with how the code changed. Contributor-only changes go in one "For contributors" line at the end of Changed. Add the compare link at the bottom.

## Releasing

Marketplace installs only update when `version` in `.claude-plugin/plugin.json` changes, so every release:

1. Bump `version` in `plugin.json` (only there; the marketplace entry has none).
2. In both changelogs, rename Unreleased to `[<version>] - <date>`, write the opening sentences, add an empty Unreleased above it and the compare links at the bottom.
3. Run `node tools/check.mjs`, push, then `claude plugin tag --push .` (tag `ctx-handoff--v<version>`).
4. Publish the GitHub Release with both languages: `node tools/docs.mjs release <version> > notes.md`, then `gh release create ctx-handoff--v<version> --title "ctx-handoff <version>" --notes-file notes.md --prerelease` (pre-release until 1.0).

Never change the plugin `name` (`ctx-handoff`) or the marketplace `name` (`ctx-handoff-mod`): existing installs refer to them.

## Where to read first

- [`CLAUDE.md`](CLAUDE.md): design decisions, platform behavior that was measured, and limits of the test engine. It's written in Traditional Chinese for the maintainer and AI assistants; read it before changing how handoff, notes or the panel work.
- [`tools/README.md`](tools/README.md): the development scripts.

