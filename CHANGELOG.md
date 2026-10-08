# Changelog

[繁體中文](CHANGELOG.zh-TW.md)

All notable changes to ctx-handoff. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/); before 1.0, any minor version may change behavior. The version is the one in `.claude-plugin/plugin.json`; marketplace installs update only when it changes.

## [Unreleased]

### Added

- **A new front page:** the README opens with a banner and an animated overview, shows each feature in a picture, and moves the details into a [guide](docs/guide.md).
- **Changelog in Traditional Chinese:** `CHANGELOG.zh-TW.md`, and GitHub Releases carry both languages.

### Changed

- **Moving rules into your repo no longer gets stuck:** Claude doesn't have to report where it put a rule, procedure or guard. The next notes update sees it in the conversation and checks the file exists. If the conversation that was asked ends first, a later one is asked; there's no limit on how many times. Before, an item Claude forgot to report was never asked about again, and nothing told you.

### Fixed

- **Temporary errors no longer push Claude off a working approach:** the repeated-failure nudge now lets Claude wait and retry once when the error looks temporary, such as a timeout or a page still loading, instead of abandoning an approach that was right.
- **Nothing said just before a handoff is lost from project notes:** if a notes update was already running when the handoff started, the conversation since that update began was never added. The handoff now captures it first and updates the notes right after the running update finishes. The handoff also no longer waits for the notes update before switching.
- **A new conversation no longer gets an outdated progress note after a handoff:** when the last notes update finished after the switch, the progress it found was dropped, and an older note from another conversation could be offered instead.

## [0.5.0] - 2026-10-08

Claude now notices its own slips: a nudge when it retries the same failure, a check when it says "done" without testing, and a reminder when it drifts out of your language. New conversations learn where the last one stopped, routines you repeat become project skills, and every setting moved to one panel tab.

**Upgrading:** settings you made in 0.4 are kept; they now show on the panel's Settings tab (`/handoff panel`, then 5) instead of `/config`.

### Added

- **Where you left off:** after your own `/clear`, a crash or a fresh start, the next conversation in the folder is told once what the last one was doing and what came next (within 24 hours). It rides on the notes update, so it costs no extra request. Setting: `resume_hint`.
- **Nudge on repeated failure:** when a tool fails twice in a row for the same reason, Claude is told to find the cause instead of retrying as is. Setting: `retry_nudge`.
- **Check before "done":** when Claude says it's done after editing code with no test, build or check since, it's asked once to verify and show the result. Setting: `done_check`.
- **Reply language reminder:** when Claude's explanation drifts out of your language (Traditional or Simplified Chinese, English, Japanese), it's reminded once, during the turn. Code, paths and English terms inside Chinese don't count. Setting: `reply_language`.
- **Procedures become project skills:** multi-step routines you had Claude repeat (say, a release) are noted as procedures; after 3 times Claude turns one into `.claude/skills/<name>/SKILL.md` in your repo, without committing.
- **Settings tab in the panel:** every setting in one place, with where each value comes from and a reset button.
- **Adjustable notes interval:** `distill_every` (default 30 messages).

### Changed

- **Better handoff summaries:** verified work is kept apart from unverified changes, failed approaches and loose ends are listed, limits you set are kept, and the summary ends with one next step.
- **Settings left `/config`:** they're on the panel instead, so `/config` stays short. Values in `settings.json` still work, for the VS Code extension, which doesn't show the panel; the panel's value wins.
- The README is rewritten for first-time readers.
- For contributors: Biome lint in the checks, the code split into smaller files, and tests split by topic.

### Fixed

- The "done" check no longer counts edits made by background subagents as the main conversation's.

## [0.4.0] - 2026-10-07

Rules that keep coming up now move into your repo, where every machine and tool sees them, and settings no longer require editing code.

### Added

- **Rules move into your repo:** a rule that came up 3 times, or a guard that's on, is handed to Claude at the start of the next conversation in a git repo. Claude puts it where the project keeps its rules, checks for duplicates, doesn't commit, and says where it went; ctx-handoff then stops loading its own copy. Say no and it's undone.

### Changed

- **Settings no longer live in the code:** threshold, idle time, keep-warm count, smallest conversation, notes model and language are plugin settings, kept across updates.
- Keeping the cache warm is confirmed on real sessions: the 2nd and 3rd refreshes (110 and 165 minutes idle) read the whole conversation from cache.
- For contributors: the code is split into smaller files, with a code style in `CONTRIBUTING.md` and an `.editorconfig`.

### Fixed

- The tool Claude uses to report a rule moved into the repo stays available after a session is resumed or the mod reloads.

## [0.3.0] - 2026-10-07

Install it from the plugin marketplace, read it in English, and approve guards from a panel.

### Added

- **Install from the plugin marketplace:** `claude plugin marketplace add cablate/ctx-handoff-mod`, then `claude plugin install ctx-handoff@ctx-handoff-mod`.
- **English messages:** messages follow your system language or Claude Code's `language` setting: Traditional Chinese for Chinese, English otherwise.
- **Guards:** `/handoff guard suggest` turns a rule that came up 3 times into a check on tool calls (block or remind). Nothing applies until you approve it.
- **Panel:** `/handoff panel` opens a panel above the prompt to approve guards, see the latest notes update and delete wrong notes (backed up first).
- The status line counts down to the next notes update and shows when one is running.

### Changed

- Handoff summaries and project notes are written in the language you use in the conversation.
- Each memory is a one-line title plus details. Preferences and corrections load in full; facts and locations load as titles only.
- Facts and locations unconfirmed for 30 days are archived (not loaded, not deleted) instead of capping the number of notes.

### Fixed

- Messages no longer repeat the `[ctx-handoff]` prefix that Claude Code already adds.
- The idle cache timer picks up again after the mod reloads.
- The panel no longer reads files on every redraw, which made buttons feel stuck.

## 0.2.0 - 2026-10-05

Notes stay in the project you started in, and updating them costs far less.

**Upgrading from 0.1:** notes an older version put in the wrong place aren't moved for you. Move them by hand, or with `node tools/notes.mjs` (see [`tools/README.md`](tools/README.md)).

### Added

- `/handoff` becomes `/ctx-handoff` when the name is already taken by your own command or skill.
- Time limits on handoff and notes requests.

### Changed

- One notes file per project folder (the folder the session started in). Notes are no longer written into other repos a session touches.
- Notes are updated by Sonnet 5.5 at low effort from only the new part of the conversation, instead of a copy of the whole conversation.

## 0.1.0 - 2026-10-03

First release: automatic handoff at a context threshold, keeping the cache warm while you're away with a saved handoff after that, and project notes.

[unreleased]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.5.0...HEAD
[0.5.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.4.0...ctx-handoff--v0.5.0
[0.4.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.3.0...ctx-handoff--v0.4.0
[0.3.0]: https://github.com/cablate/ctx-handoff-mod/releases/tag/ctx-handoff--v0.3.0
