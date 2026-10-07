# Changelog

Notable changes to ctx-handoff. Versions follow the `version` in `.claude-plugin/plugin.json`.

## Unreleased

### Changed

- Code checks add Biome lint (`biome.json`, run by `tools/check.mjs` and CI through `npx`, no npm dependency).
- The permissions table names the three environment variables read, and now explains every hook and call that `claude plugin validate` lists.
- The English README shows the status line in English.

## 0.4.0 – 2026-10-07

### Added

- **Rules move into your repo:** a rule that came up 3 times, or a guard that's on, is handed to Claude at the start of the next conversation in a git repo. Claude puts it where the project keeps its rules, checks for duplicates, doesn't commit, and reports where it went; ctx-handoff then stops loading its own copy. Say no and it's undone and not asked again.

### Changed

- **Settings no longer live in the code:** threshold, idle time, keep-warm count, smallest conversation, notes model and language are plugin settings (`/plugin configure`, or `pluginConfigs` in `settings.json`), kept across updates. Editing `hooks/register.ts` is no longer needed.
- Removed the "cache keeping isn't confirmed" limitation: real sessions show the 2nd and 3rd refreshes (110 and 165 minutes idle) reading the whole conversation from cache.
- The code is split into smaller files, and `CONTRIBUTING.md` describes the code style; `.editorconfig` added.

### Fixed

- The tool Claude uses to report a rule moved into the repo stays available after a session is resumed or the mod reloads.

## 0.3.0 – 2026-10-07

### Added

- **English messages:** messages follow your system language (or Claude Code's `language` setting): Traditional Chinese for Chinese, English otherwise. Set `UI_LANG` to force one.
- **Install from the plugin marketplace:** `claude plugin marketplace add cablate/ctx-handoff-mod`, then `claude plugin install ctx-handoff@ctx-handoff-mod`.
- **Guards:** `/handoff guard suggest` turns a rule that came up 3 times into a check on tool calls (block or remind). Nothing applies until you approve it with `/handoff guard on N`.
- **Panel:** `/handoff panel` opens a panel above the prompt to approve guards, see the latest notes update and delete wrong notes (backed up first).
- The status line counts down to the next notes update and shows when one is running.

### Changed

- Handoff summaries and project notes are written in the language you use in the conversation.
- Each memory is now a one-line title plus details. Preferences and corrections load in full; facts and locations load as titles only.
- Facts and locations unconfirmed for 30 days are archived (not loaded, not deleted) instead of capping the number of notes.
- Status line, toast and log text no longer repeat the `[ctx-handoff]` prefix.

### Fixed

- Command replies no longer repeat the `[ctx-handoff]` prefix that Claude Code already adds.
- The idle cache timer picks up again after the mod hot-reloads.
- The panel no longer reads files on every redraw, which made buttons feel stuck.

## 0.2.0 – 2026-10-05

### Changed

- One notes file per project folder (the folder the session started in). Notes are no longer written into other repos a session touches.
- Notes are updated by Sonnet 5.5 at low effort from only the new part of the conversation, instead of a copy of the whole conversation.

### Added

- `/handoff` becomes `/ctx-handoff` when the name is already taken by your own command or skill.
- Time limits on handoff and notes requests.

### Upgrading from 0.1

Notes an older version put in the wrong place aren't moved for you. Move them by hand, or with `node tools/notes.mjs` (see [`tools/README.md`](tools/README.md)).

## 0.1.0 – 2026-10-03

First release: automatic handoff at a context threshold, keeping the cache warm while you're away with a saved handoff after that, and project notes.
