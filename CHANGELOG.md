# Changelog

Notable changes to ctx-handoff. Versions follow the `version` in `.claude-plugin/plugin.json`.

## 0.5.0 – 2026-10-08

### Added

- **Procedures become project skills:** background notes now also learn multi-step routines you had Claude repeat (e.g. release: bump version → changelog → tag → GitHub release), kept in a new `## 流程` section of the notes file with a name, when to use it, 2–8 steps, a count and evidence. They are not loaded into new conversations. Once a procedure has come up 3 times, the next conversation in a git repo asks Claude to create `.claude/skills/<name>/SKILL.md` (or extend an existing skill or doc), without committing; `mark_in_project` takes a `procedure` entry like it does for rules. The panel lists procedures under the Rules tab, and `/handoff` shows how many there are.
- **Better handoff summaries:** the summary now separates verified work from unverified changes, lists approaches that failed, notes anything still running or unsaved, keeps limits you set during the work, and ends with one concrete next step.
- **Two safety nudges, on by default:** when the same tool call fails twice in a row for the same reason, Claude is told to change approach instead of retrying (`retry_nudge`); when Claude says the work is done after editing code files but ran no test, build or check, it is asked once to verify first (`done_check`). `/handoff` shows both switches.
- **Reply language reminder:** when Claude's explanation is mostly not in your language (Traditional or Simplified Chinese, English, Japanese), it is reminded once with the next tool result, or with your next message after a final answer. Code, commands, paths, links and short lines are ignored, so Chinese with English terms doesn't trigger it. Setting: `reply_language` (`auto` follows Claude Code's `language` setting; `off` disables it). `/handoff` shows it on the nudges line.
- **Where you left off:** each background notes update also saves a short per-folder progress note (task, state, last check, next step, key files; about 600 characters). The next conversation in that folder, including after your own `/clear` or a crash, is told about it once if it is under 24 hours old; skipped when a handoff already covered that conversation. `/handoff` shows it. Setting: `resume_hint`.

### Changed

- **Settings moved to the panel:** a new Settings tab (`/handoff panel`, tab 5) changes every setting, including the cache and notes switches, and shows where each value comes from; a change applies at once here and from the next message in other sessions. The plugin no longer declares `userConfig`, so nothing is listed in `/config` or `/plugin configure`. Values in `pluginConfigs` in `settings.json` still work (for the VS Code extension, which doesn't show the panel); the panel's value wins.
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
