# Changelog

[繁體中文](CHANGELOG.zh-TW.md)

All notable changes to ctx-handoff. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/); before 1.0, any minor version may change behavior. The version is the one in `.claude-plugin/plugin.json`; marketplace installs update only when it changes.

## [Unreleased]

### Changed

- **Sharper nudges after repeated failures:** when the same tool fails twice for the same reason, the reminder names the tool and points at the fix: Edit and MultiEdit suggest checking the exact text with Grep (`rg -F`) or Read with an offset and limit, and using `node ~/.claude/tools/safe-replace.mjs` for multiple replacements; Read suggests finding the file with Glob or checking the parent folder first. A second reminder follows at the fourth consecutive failure. Other tools keep the existing wording. Setting: `retry_nudge`.
- **Fewer reply-language false alarms:** a reply now needs at least 40 English words (up from 16) before the language check runs, and one language must make up more than 75% of the text (up from 60%) before it counts as dominant. Chinese replies carrying English terms or a short log no longer trigger a reminder. Setting: `reply_language`.
- **Status labels when a "done" claim is blocked:** the nudge now asks Claude to end with one of four states: `[已完成且已實測]`, `[已部署但待正式驗收]`, `[已修改但未實測（附原因）]` or `[待你拍板]`. Setting: `done_check`.

## [0.8.2] - 2026-10-18

Progress notes now last 7 days so you can pick up after a weekend, the "done" check catches failed test runs instead of only missing ones (and ignores temporary files in `scratchpad/`), and the default idle refresh moves to 50 minutes to stay ahead of Claude Code 2.1.299+'s 54-minute idle compaction.

### Changed

- **Progress notes last 7 days across weekends:** progress notes used to expire after 24 hours, so Friday's context was gone by Monday morning. As long as no handoff has replaced it, a new conversation within 7 days still gets where you left off (showing "N days ago" past 24 hours). Setting: `resume_hint`.
- **Default idle refresh moved to 50 minutes:** Claude Code 2.1.299+ automatically compacts 200k+ token conversations after 54 idle minutes. Moving the default from 55 to 50 minutes refreshes your 1-hour cache before auto-compaction runs. Setting: `idle_minutes`.

### Fixed

- **"Done" check catches failed tests and ignores `scratchpad/` files:** previously, running a test that failed still satisfied the check if Claude claimed it was done without mentioning the failure; conversely, writing a temporary file in Claude's `scratchpad/` folder could trigger the check when no project code changed. Failed checks now block unless Claude reports the failure, and `scratchpad/` paths are ignored. Setting: `done_check`.

## [0.8.1] - 2026-10-18

As project notes grow, new conversations now load full details only for recent or repeated preferences—folding older one-off corrections down to their title and archiving them after 30 days to save tokens. Sessions started in your home directory no longer auto-update or load project notes, and idle windows no longer log repeated timeout errors every hour.

### Changed

- **Older one-off notes fold to titles and archive automatically:** preferences and corrections (`user` and `feedback`) from the last 14 days or with 2+ occurrences still load in full; one-off corrections older than 14 days load as a one-line title (Claude can read the file when needed), and one-off corrections untouched for 30 days are archived automatically without manual cleanup.
- **Sessions started in your home directory skip auto-notes:** opening a terminal in `~` or `%USERPROFILE%` for a quick question isn't a single project, so sessions started there no longer auto-update or auto-load project notes instead of mixing unrelated chats into one file (`/handoff distill` still works manually).

### Fixed

- **Idle windows no longer retry and log timeouts every hour:** previously, if an idle notes update hit an API timeout, every subsequent cache refresh retried the same slice and logged another error. Idle updates now run at most once per idle period, and timeouts while you're away are quietly skipped until you chat again or hand off.

## [0.8.0] - 2026-10-17

You can now pause away work for a single conversation without turning it off everywhere (while project notes keep updating), and see right in the panel how many background tokens this session has used. Under the hood, background notes and handoff recovery are much tougher: failed updates don't skip your conversation, retries never double-count rules, deleted memories can't be brought back by something you said earlier in the same long chat, and an undelivered handoff can be recovered even after restarting Claude Code.

### Added

- **Pause away work for just this session:** if you don't want the current conversation refreshing its cache or saving an away summary when idle, click the button at the top of the panel or run `/handoff away pause` (`/handoff away resume` restarts the timer). Project notes keep updating as usual, and other open or new conversations aren't affected.
- **Live background status and session token usage:** `/handoff` and the panel now show notes updates and handoff/refresh work in separate slots so you can see what's running, along with the reported background tokens used by this session (requests that time out or return no usage are explicitly marked as unknown, never counted as zero or guessed in dollars).
- **A tighter, safer panel:** the top bar puts the away status and pause button on one compact line and moves history details into the Last update tab; deleting a guard now takes two presses ("Confirm") just like memories and rules; and when a project has procedures, the Rules tab label shows both rule and procedure counts.

### Fixed

- **Failed notes updates no longer skip your conversation:** if a notes update returns no usable actions or hits a file read error, the checkpoint stays put so the next run retries that slice of the conversation instead of dropping it.
- **Retrying a partial write never double-counts rules or procedures:** if the notes file was written but saving the checkpoint failed, the next run retries the exact same slice of conversation and recognizes evidence and memories that already landed, so rule and procedure counts aren't incremented twice.
- **Deleted memories aren't revived by older messages in the same chat:** quote matching for restoring a deleted memory now checks only the new messages since the last notes update, so something you said before deleting the memory won't bring it back on the next update.
- **Recover undelivered handoffs after a restart:** if sending a handoff fails after `/clear` and you restart Claude Code, you can now run `/handoff resend <source-session-id>` in the same workspace to deliver it safely (the record is kept until delivery succeeds, and records from other workspaces are refused).
- **Late away results don't overwrite fresh work, and fresh restarts don't spin on idle refresh:** if you come back and keep chatting (or pause away work) while an away summary or idle notes update is still running, the late result is discarded without touching your new idle timer or refresh count; and when a newly restarted or cleared session has nothing to fork yet, idle refresh stops until your next conversation turn ([#7](https://github.com/cablate/ctx-handoff-mod/issues/7)).

## [0.7.0] - 2026-10-15

Handing off at the threshold is now off by default, so Claude Code's own compact takes over while everything else keeps running. Memories you delete stay deleted, guards your repo already has stop coming back, and handoffs keep who said what.

**Upgrading:** if you relied on the automatic handoff at 600k tokens, turn on `auto_handoff` in the panel's Settings tab (`/handoff panel`, then 5).

### Changed

- **Handoff at the threshold is now off by default:** Claude Code's own compact takes over; turn on `auto_handoff` in the panel's Settings tab to use it. Keeping the cache warm, project notes and everything else are unchanged.
- **Guard list shows recent hits:** `/handoff guard` and the panel (when expanded) show the last 3 commands each guard fired on, so false alarms are easy to spot ([#6](https://github.com/cablate/ctx-handoff-mod/issues/6)).
- **Handoffs keep who said what:** the next step quotes your latest request and stops at "waiting for you" when that work is done; hook feedback and injected notes are no longer written up as your requests; rules about forbidden operations and secrets are copied word for word. Borrowed from Claude Code's own compact prompt.
- **README animations in both languages:** the Traditional Chinese README has its own banner and animations, and the guards and panel section shows an animation instead of a screenshot. The guide uses the same animations, and the banner lists what ctx-handoff does now that threshold handoff is off by default.

### Fixed

- **Memories you delete stay deleted:** whether removed in the panel, with `tools/notes.mjs` or by editing the file, distill won't add the same memory back (or reword it back) for 90 days, unless you bring it up again yourself in the conversation ([#3](https://github.com/cablate/ctx-handoff-mod/issues/3)).
- **Guards the repo already has stop coming back:** at the start of a new conversation ctx-handoff checks the repo's `.claude/hooks/` and `.claude/settings.json`; if a guard's message is already written there, the guard is recorded as in that file and ctx-handoff's own copy is turned off, so Claude is not asked to add it again and the reminder no longer shows up twice ([#2](https://github.com/cablate/ctx-handoff-mod/issues/2)).
- **No more duplicate evidence lines from one conversation:** when the same session confirms a memory again, its earlier evidence line is replaced instead of a reworded copy being added ([#3](https://github.com/cablate/ctx-handoff-mod/issues/3)).
- **Handoffs no longer point at notes by line number:** they use the entry's title or a unique phrase, since the pre-handoff distill rewrites the notes and shifts lines ([#4](https://github.com/cablate/ctx-handoff-mod/issues/4)).

## [0.6.0] - 2026-10-09

Handoff summaries now carry most of what the next conversation needs, project notes follow what you actually care about, and rules that keep failing turn into guards Claude asks you about. Items moved into your repo no longer get stuck, and leftover `/config` rows are gone.

### Added

- **A new front page:** the README opens with a banner and an animated overview, shows each feature in a picture, and moves the details into a [guide](docs/guide.md).
- **Changelog in Traditional Chinese:** `CHANGELOG.zh-TW.md`, and GitHub Releases carry both languages.

### Changed

- **Guards ask you:** a rule you had to correct again after it went into your repo (or said 3 times while keeping it out) gets a guard drafted in the background, and the next conversation has Claude ask whether to use it. Answer in the conversation; no command or panel needed. Before, you had to run `/handoff guard suggest`, so guards were rarely used.
- **Background prompts reworded:** loaded preferences say to follow them without asking again; the reply-language reminder leaves translations and English documents you asked for alone; the "said done without checking" nudge asks Claude to show what it ran and the result.
- **Project notes follow your standard:** decisions with their reasons (even ones already in the code) and how you like to work are kept; decisions that only matter for the task at hand go to the progress note; things already in your CLAUDE.md files aren't repeated; something Claude proposed and you just okayed is kept as a decision, not as your request. A rule's count is how many times you had to say it; Claude following it doesn't add to it.
- **No length cap on the progress note:** the per-field limits and the 600-character total are gone, and it now keeps the decisions that matter until the task is done.
- **Handoff summaries say more:** the 1800-character cap is gone. A summary now keeps the limits you set in your own words, says where the work stopped, what was already found out and how to run the tools, and gives questions waiting for you their background and options. Measured on real handoffs, it covers over 90% of what the next conversation needed, up from about half. Longer summaries take about 45 seconds to 2 minutes to write, so a handoff now waits up to 5 minutes (was 3).
- **Moving rules into your repo no longer gets stuck:** Claude doesn't have to report where it put a rule, procedure or guard. The next notes update sees it in the conversation and checks the file exists. If the conversation that was asked ends first, a later one is asked; there's no limit on how many times. Before, an item Claude forgot to report was never asked about again, and nothing told you.

### Fixed

- **Temporary errors no longer push Claude off a working approach:** the repeated-failure nudge now lets Claude wait and retry once when the error looks temporary, such as a timeout or a page still loading, instead of abandoning an approach that was right.
- **No leftover settings rows in `/config`:** 0.5 moved settings to the panel, but 7 of them, including the threshold, idle minutes, notes model and language, still showed in `/config`. They are on the panel only now; values in `settings.json` still work.
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

[unreleased]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.8.2...HEAD
[0.8.2]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.8.1...ctx-handoff--v0.8.2
[0.8.1]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.8.0...ctx-handoff--v0.8.1
[0.8.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.7.0...ctx-handoff--v0.8.0
[0.7.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.6.0...ctx-handoff--v0.7.0
[0.6.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.5.0...ctx-handoff--v0.6.0
[0.5.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.4.0...ctx-handoff--v0.5.0
[0.4.0]: https://github.com/cablate/ctx-handoff-mod/compare/ctx-handoff--v0.3.0...ctx-handoff--v0.4.0
[0.3.0]: https://github.com/cablate/ctx-handoff-mod/releases/tag/ctx-handoff--v0.3.0
