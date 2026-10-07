# Contributing

Thanks for helping. Bug reports and ideas go in [issues](https://github.com/cablate/ctx-handoff-mod/issues/new/choose); please include your Claude Code version and the output of `/handoff`.

## Code changes

You need Node 22 and a Claude Code build with mods.

1. Fork and clone the repo, then load your copy: `claude --plugin-dir /path/to/ctx-handoff`.
2. Edit `hooks/register.ts` (logic) or `hooks/panel.tsx` (panel). The mod hot-reloads when you save, so open sessions pick up half-finished edits; `node tools/wt.mjs new <branch>` gives you a separate worktree to work in.
3. Add or update tests in `hooks/register.test.ts`. A bug fix should come with a test that fails without it.
4. Run `node tools/check.mjs` (plugin validate, plugin test, `tsc`, tool tests). It must pass.
5. If the change is visible to users, update both `README.md` and `README.zh-TW.md`, and add a line to `CHANGELOG.md` under Unreleased.

## Where to read first

- [`CLAUDE.md`](CLAUDE.md): design decisions, platform behavior that was measured, and limits of the test engine. It's written in Traditional Chinese for the maintainer and AI assistants; read it before changing how handoff, notes or the panel work.
- [`tools/README.md`](tools/README.md): the development scripts.

User-facing messages are currently in Traditional Chinese. Keep new ones short and plain, and don't prefix them with `[ctx-handoff]` (Claude Code adds the mod name).
