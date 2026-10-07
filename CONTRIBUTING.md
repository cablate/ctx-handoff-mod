# Contributing

Thanks for helping. Bug reports and ideas go in [issues](https://github.com/cablate/ctx-handoff-mod/issues/new/choose); please include your Claude Code version and the output of `/handoff`.

## Code changes

You need Node 22 and a Claude Code build with mods.

1. Fork and clone the repo, then load your copy: `claude --plugin-dir /path/to/ctx-handoff`.
2. Find the code in `hooks/`: `register.ts` (hooks, commands and everything that touches session state), `notes.ts` (notes file format, memory tiers, text injected into new chats), `distill.ts` (background-distill prompt, model actions, secret check), `guards.ts` (guard types, matching, proposal checks), `transcript.ts` (conversation to text), `paths.ts` (path helpers), `panel.tsx` (panel), `i18n.ts` (UI strings). The mod hot-reloads when you save, so open sessions pick up half-finished edits; `node tools/wt.mjs new <branch>` gives you a separate worktree to work in.
3. Add or update tests in the matching `hooks/*.test.ts` (`handoff`, `handoff-failure`, `distill`, `notes-file`, `guards`, `panel`, `promote`, `config`; shared mocks and helpers live in `hooks/test-world.ts`, which is not a test file itself). A bug fix should come with a test that fails without it.
4. Run `node tools/check.mjs` (plugin validate, plugin test, `tsc`, tool tests). It must pass.
5. If the change is visible to users, update both `README.md` and `README.zh-TW.md`, and add a line to `CHANGELOG.md` under Unreleased.

## Code style

- TypeScript, ES modules, 2-space indent, single quotes, no semicolons. `.editorconfig` sets the basics for your editor.
- `tsc` in strict mode and [Biome](https://biomejs.dev) lint (rules in `biome.json`) are the checks; `node tools/check.mjs` and CI run both. Biome runs through `npx` at a fixed version, so the repo still has no npm dependencies. To run it alone: `npx @biomejs/biome@2.5.15 lint .`
- Code comments and `CLAUDE.md` are in Traditional Chinese, the maintainer's language. English comments are welcome in your changes.
- Messages people see live in `hooks/i18n.ts`, in both English and Traditional Chinese; add both when you add one. Don't prefix them with `[ctx-handoff]` (Claude Code adds the mod name).

## Releasing

Marketplace installs only update when `version` in `.claude-plugin/plugin.json` changes, so every release:

1. Bump `version` in `plugin.json` (only there; the marketplace entry has none).
2. Move the Unreleased notes in `CHANGELOG.md` under the new version and date.
3. Push, then tag `ctx-handoff--v<version>` and publish a GitHub Release with the same notes.

Never change the plugin `name` (`ctx-handoff`) or the marketplace `name` (`ctx-handoff-mod`): existing installs refer to them.

## Where to read first

- [`CLAUDE.md`](CLAUDE.md): design decisions, platform behavior that was measured, and limits of the test engine. It's written in Traditional Chinese for the maintainer and AI assistants; read it before changing how handoff, notes or the panel work.
- [`tools/README.md`](tools/README.md): the development scripts.

