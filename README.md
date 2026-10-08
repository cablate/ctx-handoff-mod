# ctx-handoff

[繁體中文](README.zh-TW.md)

[![check](https://github.com/cablate/ctx-handoff-mod/actions/workflows/check.yml/badge.svg)](https://github.com/cablate/ctx-handoff-mod/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A Claude Code mod that keeps long conversations going on their own, remembers what you taught Claude, and catches the usual slips.**

Long Claude Code sessions run into the same chores again and again:

| Situation | Without it | With ctx-handoff |
|---|---|---|
| The conversation is nearly full | You write a summary, `/clear`, paste it back | A handoff summary is written, the conversation is cleared, and the new one reports where things stand, then waits for you |
| You step away for an hour | Your next message rereads everything, slowly and at full price | The cache is kept warm while you're gone (up to about 4 hours); after that a summary is saved for when you're back |
| You repeat an instruction | The next conversation forgets it | It becomes a note for this project, and after 3 times Claude moves it into your repo |
| You `/clear` or reopen Claude Code | The new conversation doesn't know where you stopped | It's told once what the last one was doing and what came next |
| Claude retries the same failing command, or says "done" without testing | You notice later | Claude gets a short nudge right away |

In normal use you type no commands.

<img src="docs/distill-demo.gif" width="300" alt="Demo: the user repeats the same instruction three times and a new conversation forgets it; ctx-handoff turns it into a rule, and the next conversation remembers">

(The demo text is in Traditional Chinese.)

## Quick start

Requires Claude Code 2.1.287 or later (mods are on by default from there). Tested up to 2.1.293.

```sh
claude plugin marketplace add cablate/ctx-handoff-mod
claude plugin install ctx-handoff@ctx-handoff-mod
```

Start a new session and type `/handoff`. A status like this means it's installed:

```
context 12034 / threshold 600000 (window 1000000)
Cache refresh on, refreshed 0/3 this idle period, timer not started
```

Updates aren't automatic: run `claude plugin update ctx-handoff@ctx-handoff-mod`, or turn on auto-update under **Marketplaces** in `/plugin`.

**Best fit:** you sign in with a Claude subscription, run long sessions (for example on a 1M-context model), and start Claude Code in your project folder. On an API key, Bedrock or Vertex the cache lasts only 5 minutes, so turn cache keeping off (`/handoff refresh off`); everything else works.

**Status:** experimental. Claude Code's mod feature is still in early access, so a Claude Code update may need a matching update here.

## What it does

### Handoff when the conversation is nearly full

At 600k tokens (80% of smaller windows) it waits for Claude to finish its turn, its background tasks and subagents, then writes a handoff summary, clears the conversation and sends the summary into the new one. The new conversation says what it understood and waits for you.

The summary keeps apart what was verified (tests run, results seen) and what was only changed, lists approaches that failed so they aren't tried again, notes anything still running or unsaved, keeps limits you set ("ask before pushing"), and ends with one concrete next step.

- Background work that never ends (a dev server) doesn't block it forever: it hands off anyway 150k tokens past the threshold, and before 90% of the window.
- Anything you type during a handoff goes to the new conversation with the summary. Attachments can't be held; you're asked to paste them again.
- `/handoff now` hands off right away; `/handoff dry` shows a summary and its cost without clearing.

### Cache kept warm while you're away

After about 55 idle minutes it sends a tiny request so the conversation cache doesn't expire, up to 3 times (about 4 hours). After that it saves a handoff summary but doesn't clear. When you come back, your first message is held and you choose: `/handoff resume` starts a new conversation from the summary, `/handoff continue` stays where you were.

### Project notes

What you correct or explain is collected into one notes file per project, loaded into each new conversation. It's plain Markdown you can edit: `~/.claude/projects/<project path>/memory/ctx-handoff.md`.

- **Memories:** preferences, corrections, facts and locations. Preferences and corrections load in full, and only when they match something you actually said. Facts and locations load as titles; Claude reads the rest when it needs it. Facts unconfirmed for 30 days are archived (not loaded, not deleted).
- **Rules:** practices that keep coming up, such as "use forward slashes in Bash paths (3 times)". Loaded once seen twice.
- **Procedures:** multi-step routines you had Claude repeat, such as "release: bump the version → changelog → tag → GitHub release". Not loaded, to keep the context small.

The notes update every 30 of your messages, after 55 idle minutes, before a handoff, or on `/handoff distill`. Only the new part of the conversation is sent, to Sonnet 5.5 at low effort; a short update takes about 1,200 tokens. Conversations under 30k tokens are skipped. Anything that looks like a key or password is dropped. The status line counts down ("18 more messages until notes update").

**Into your repo after 3 times.** When a rule has come up 3 times (or a guard is on), the next conversation in a git repo asks Claude, after it finishes what you asked, to put it where your project keeps its rules: CLAUDE.md, AGENTS.md or an existing hook. A procedure that came up 3 times becomes a project skill, `.claude/skills/<name>/SKILL.md`. Claude checks for duplicates, doesn't commit, and tells you in one line what it added and where, so it shows up in your usual diff. From then on the repo holds it, for every machine and tool, and ctx-handoff stops loading its own copy. Say no and it's undone and not asked again.

### Where you left off

If you `/clear` yourself, Claude Code crashes, or you just open a new conversation, the new one doesn't know where the last one stopped. Each notes update therefore also keeps a short progress note for the folder: the task, whether it's done, in progress or blocked, the last check that passed, the next step and up to 5 key files. It rides in the same request as the notes.

The next conversation in that folder is told about it once, within 24 hours: "the last conversation (2 hours ago) stopped at…". If you carry on, Claude starts from there; if you're doing something else, it ignores it. Conversations that were handed off automatically don't get it, since the summary already covers them.

### Nudges

Short messages to Claude, never a block on your tools. All on by default.

- **Repeated failure:** when a tool fails twice in a row for the same reason, Claude is told to find the cause and change approach instead of retrying as is.
- **"Done" without checking:** when Claude says it's done after editing code this turn with no test, build or check since, it's asked once to verify and show the result, or say what it couldn't verify. Doc edits don't count. Claude Code shows this as "Stop hook feedback" and may label it a Stop hook error; that's the nudge, not a failure.
- **Reply language:** when Claude's explanation is mostly not in your language (Traditional or Simplified Chinese, English, Japanese), it's reminded once. Code, commands, paths, links and short lines are ignored, so Chinese with English terms is fine. It also fires when you asked for another language on purpose, such as a translation.

### Guards

Once a rule has come up 3 times, `/handoff guard suggest` drafts a check on tool calls from it, such as "git push without running tests", set to block or to remind. **Nothing applies until you approve it.** If a check itself fails, the call goes through.

### Panel

`/handoff panel` opens a panel above the prompt with five tabs: guards to approve, memories, rules and procedures, the latest notes update, and settings. Deleting a note takes two presses and backs up the file first. Click the buttons, or press ctrl+x tab and then 1–5 to switch tabs. Run the command again to close it.

<img src="docs/panel.png" width="560" alt="The panel above the prompt, on the Rules tab: tabs for guards, memories, rules and the latest update, then rules such as checking the deployed version before announcing a release, each with how many times it came up. Text in Traditional Chinese.">

## Settings

Everything is set on the panel's Settings tab, not in `/config`. Numbers step with `−` and `＋`; switches and choices change with Toggle. Each row shows where its value comes from (panel, settings.json or default), More explains it, and Reset drops the panel's value. Changes apply at once in the current session and from the next message in other open ones. They cover all your projects and survive updates.

| Setting | Default | Meaning |
|---|---|---|
| `threshold` | `600000` | Context tokens that trigger a handoff |
| `window_ratio` | `0.8` | On smaller windows, hand off at `window × ratio` |
| Keep cache warm | on | Also `/handoff refresh on\|off` |
| `idle_minutes` | `55` | Idle minutes before each keep-warm request (5–59) |
| `max_refresh` | `3` | Keep-warm requests per idle period before saving a summary instead |
| Project notes | on | Also `/handoff distill on\|off` |
| `distill_every` | `30` | Your messages between notes updates (5–200) |
| `min_tokens` | `30000` | Smaller conversations skip cache keeping, away summaries and notes |
| `notes_model` | `claude-sonnet-5-5` | Model for notes: Sonnet 5.5 or Opus 5.5 |
| `resume_hint` | on | Tell a new conversation where the last one stopped |
| `retry_nudge` | on | Repeated failure nudge |
| `done_check` | on | "Done" without checking nudge |
| `reply_language` | `auto` | Reply language nudge: `auto`, `off`, `zh-TW`, `zh-CN`, `en` or `ja` |
| `language` | `auto` | Language of the status line, notices and panel: `auto`, `en` or `zh-TW` |

`auto` follows Claude Code's own `language` setting. For the reply language, an unset `language`, or just "Chinese" without Traditional or Simplified, means off. For messages, it falls back to your system language. Notes and summaries are written in the language you use in the conversation.

**Choosing a threshold:** quality is commonly seen to start slipping around 200k–300k tokens. The 600k default trades that for fewer handoffs; lower it if Claude gets worse before the handoff.

**In a file instead.** The VS Code extension doesn't show the panel. There, or if you'd rather keep settings in a file, put them in `~/.claude/settings.json` (for a clone, the key is `ctx-handoff@inline`). A value set on the panel wins over the file.

```json
"pluginConfigs": { "ctx-handoff@ctx-handoff-mod": { "options": { "threshold": 400000, "reply_language": "zh-TW" } } }
```

## Commands

You won't need these in normal use. If `/handoff` is taken by your own command or skill, it's `/ctx-handoff` instead.

| Command | Purpose |
|---|---|
| `/handoff` | Context use, what's on, the latest progress note and recent errors |
| `/handoff panel` | Open or close the panel |
| `/handoff now` | Hand off now (clears the conversation) |
| `/handoff dry` | Show a handoff summary and its cost, without clearing |
| `/handoff distill` | Update the project notes now |
| `/handoff resume` / `continue` | After being away: start fresh from the summary, or stay |
| `/handoff resend` | Send the handoff summary again if it didn't arrive |
| `/handoff refresh on\|off`, `distill on\|off` | Turn cache keeping or project notes on or off |
| `/handoff guard` | List guards; `suggest` drafts new ones, `on\|off\|drop N` approves, turns off or deletes one, `mode N deny\|remind` switches between blocking and reminding |

## Cost, privacy and permissions

**Cost.** Everything runs on your own Claude Code sign-in and counts toward your usage like any other request.

- Handoff: one request that reads the conversation (mostly from cache) and writes the summary, about 30 seconds at 800k tokens.
- Keeping the cache warm: a tiny request that reads the conversation from cache, at about a tenth of the normal input price; at most 3 per idle period.
- Notes: only the new part of the conversation, to Sonnet 5.5 at low effort. The progress note rides in the same request.
- The nudges make no requests.

**What leaves your machine.** Nothing goes anywhere but Anthropic, through Claude Code, like the conversation itself. A notes update sends your messages, Claude's replies and tool calls (the first 300 characters of each input and 500 of each result), up to 300,000 characters.

**What it stores locally:**

| What | Where |
|---|---|
| Project notes | `~/.claude/projects/<project path>/memory/ctx-handoff.md` |
| Backups made before deleting from the panel | `.ctx-handoff-backup/` next to the notes file |
| Settings set on the panel, recent handoff summaries, progress notes, errors | `~/.claude/plugins/store/ctx-handoff_*.json` |

**What it's allowed to do.** Mods aren't sandboxed; this one runs with your permissions. To see what it uses without running it, run `claude plugin validate <ctx-handoff folder>`. It prints a `hooks:` line (events it receives) and a `calls:` line (what its code calls):

| In the output | Why |
|---|---|
| `tool.call` | Applies guards you approved; notices repeated failures and whether tests ran after edits; carries the reply language nudge |
| `turn.step` | Reads the visible text of Claude's replies in the main conversation to check their language. It doesn't change the request, the model or the reply |
| `prompt.submit`, `prompt.context` | Holds your message during a handoff; loads notes and the progress note into a new conversation; rereads settings |
| `$.session.messages`, `$.model.complete`, `$.model.fork` | Reads the conversation to write notes and handoff summaries |
| `$.fs.read`, `$.fs.write`, `$.fs.exists` | Reads and writes the notes file and its backups; checks whether the project is a git repo |
| `$.prompt.submit`, `$.command.run` | Sends the summary into the new conversation; runs `/clear` |
| `$.env.get` | Reads three environment variables, `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE`, only to find your `~/.claude` folder. Nothing needs to be set |
| `$.tool.register` | Gives Claude one tool, `mark_in_project`, to report where it put a rule or procedure in your repo |
| `$.settings.read`, `config.set` | Reads Claude Code's `language` setting and this plugin's `pluginConfigs`; notices when you change Claude Code's settings |
| The rest: `session.start`, `turn.complete`, `classic.Stop`, `command.run`, `$.command.register`, `ui.render`, `$.store`, `$.state`, `$.clock`, `$.ui`, `$.agent.list`, `$.session.*` | Bookkeeping: timers, the `/handoff` command, status line, panel and notices, its own storage, checking that Claude and its subagents are done before a handoff, and the "done" nudge |

It makes no network requests of its own and starts no programs (no `$.http` or `$.process` calls). To run a session without any mod, start Claude Code with `claude --safe-mode`. See also [`SECURITY.md`](SECURITY.md).

## Where it works

Mods load in most places Claude Code runs, but only the terminal and the Desktop app draw what a mod shows ([Claude Code docs](https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run)).

| Where | Background features | Status line and panel | Checked |
|---|---|---|---|
| `claude` in a terminal (also an editor's terminal, JetBrains) | Yes | Yes | Tested |
| `claude -p` | Yes; `/handoff` replies as text | No | Tested |
| Desktop app, Code tab | Yes | Yes | From the docs |
| VS Code extension chat panel | Yes (settings via `settings.json`) | No | From the docs |
| Desktop app, WSL session | No (plugins don't load there) | No | From the docs |

## Limitations

- **On a 5-minute cache, turn cache keeping off.** API key, Bedrock and Vertex users, and subscribers who've moved onto usage credits, get a 5-minute cache, so a refresh at 55 minutes rewrites the whole cache. Run `/handoff refresh off`; this isn't detected automatically.
- **Notes follow the folder you start in.** Work on another project from your home folder is noted under your home folder. Notes aren't shared across projects.
- **The progress note is only as fresh as the last notes update.** After a short chat or a crash it may be missing or a few messages behind; run `/handoff distill` before `/clear` if you want it exact. Two conversations open in the same folder see each other's note.
- **Other sessions pick up a settings change on their next message,** not at once.
- **Updating the mod mid-handoff may lose a held message.** The cache timer isn't affected.

## Troubleshooting

Start with `/handoff`: it shows context use, what's on, and the latest error from the background.

| Symptom | What to check |
|---|---|
| `/handoff` isn't a command | The mod isn't loaded: check `claude plugin list` and your Claude Code version; for a clone, use an absolute path. If you have your own `/handoff`, use `/ctx-handoff`. |
| Something odd and you suspect a mod | Start with `claude --safe-mode` and see whether it goes away. |
| The new conversation didn't get the summary | `/handoff resend`. |
| Notes never update | Conversations under 30k tokens are skipped. Run `/handoff distill` and look for an error in `/handoff`. |
| A command gives no answer | Run `/handoff` for the latest error, then [open an issue](https://github.com/cablate/ctx-handoff-mod/issues/new/choose) with its output. |

## Uninstall

1. From the marketplace: `claude plugin uninstall ctx-handoff@ctx-handoff-mod`. From a clone: remove its path from `CLAUDE_CODE_PLUGIN_DIRS` (or stop passing `--plugin-dir`) and delete the folder.
2. Optional: delete the files listed under [What it stores locally](#cost-privacy-and-permissions); uninstalling leaves them. The notes are plain Markdown, so you may want to keep them.

To turn it off for a while instead, disable it in `/plugin`.

## Run from source

Load a clone instead of the marketplace copy; saved edits take effect right away.

```sh
git clone https://github.com/cablate/ctx-handoff-mod ~/.claude/mods/ctx-handoff
claude --plugin-dir ~/.claude/mods/ctx-handoff
```

To load it in every session, add its absolute path to `env` in `~/.claude/settings.json` (separate several paths with `;` on Windows, `:` elsewhere):

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/you/.claude/mods/ctx-handoff" }
```

## More

- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version, and what to do when upgrading from 0.1.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to work on the code. Bug reports and ideas go in [issues](https://github.com/cablate/ctx-handoff-mod/issues/new/choose).
- License: [MIT](LICENSE).
