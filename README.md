<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img src="docs/assets/banner-light.svg" width="900" alt="ctx-handoff: the long-session toolkit for Claude Code">
  </picture>
</p>

<p align="center">
  <b>Keep long Claude Code sessions going on their own,<br>have Claude remember what you taught it, and catch its usual slips.</b>
</p>

<p align="center">
  <a href="https://github.com/cablate/ctx-handoff-mod/releases"><img src="https://img.shields.io/github/v/release/cablate/ctx-handoff-mod?include_prereleases&display_name=release&label=release&color=7dd3fc" alt="Latest release"></a>
  <a href="https://github.com/cablate/ctx-handoff-mod/actions/workflows/check.yml"><img src="https://github.com/cablate/ctx-handoff-mod/actions/workflows/check.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Claude_Code-2.1.287%2B-a78bfa" alt="Claude Code 2.1.287 or later">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="#install">Install</a> · <a href="#whats-inside">Features</a> · <a href="docs/guide.md">Guide</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="docs/assets/handoff.svg" width="900" alt="Animation: a long session fills its context to the threshold; ctx-handoff writes a summary of verified work, failed attempts, your limits and the next step, clears, and a fresh session continues from it">
</p>

## Why

Long Claude Code sessions run into the same chores again and again. ctx-handoff takes care of them in the background, so in normal use you type no commands.

| When… | Without it | With ctx-handoff |
|---|---|---|
| the conversation is nearly full | You write a summary, `/clear`, paste it back | A summary is written, the conversation is cleared, and a fresh one continues |
| you step away for an hour | Your next message rereads everything at full price | The cache is kept warm for up to about 4 hours |
| you repeat an instruction | The next conversation forgets it | It becomes a project note, and after 3 times a line in your repo |
| you `/clear` or reopen Claude Code | The new conversation starts blind | It's told where the last one stopped |
| Claude retries a failing command, or says "done" untested | You find out later | Claude gets a one-line nudge right away |

## Install

Requires Claude Code 2.1.287 or later. Tested up to 2.1.293.

```sh
claude plugin marketplace add cablate/ctx-handoff-mod
claude plugin install ctx-handoff@ctx-handoff-mod
```

Start a new session and type `/handoff`. You should see:

```
context 12034 / threshold 600000 (window 1000000)
Cache refresh on, refreshed 0/3 this idle period, timer not started
```

That's it. Update with `claude plugin update ctx-handoff@ctx-handoff-mod`, or turn on auto-update under **Marketplaces** in `/plugin`.

> [!NOTE]
> Built for Claude subscriptions and long sessions (for example on a 1M-context model). On an API key, Bedrock or Vertex the cache lasts only 5 minutes, so run `/handoff refresh off`; everything else works. ctx-handoff is experimental, because Claude Code mods are still in early access.

## What's inside

ctx-handoff is a growing toolkit for long sessions: new features for working with Claude over hours land here.

### Hands off before the context fills

At 600k tokens it waits for Claude and its subagents to finish, writes a summary that keeps verified work apart from unverified changes, lists what failed and the limits you set, ends with one next step, clears, and continues in a fresh conversation. Anything you type meanwhile is carried over.

### Keeps the cache warm while you're away

<img src="docs/assets/cache.svg" width="900" alt="Animation: after you leave, the cache is refreshed at 55, 110 and 165 minutes; after that a summary is saved, and when you return you choose to resume or continue">

### Learns your project, then hands it to your repo

<img src="docs/assets/memory.svg" width="900" alt="Animation: the same instruction on three days becomes a project rule, then a line in CLAUDE.md for you to review">

Preferences, corrections and facts become one Markdown notes file per project, loaded into every new conversation. Routines you repeat become project skills. Only the new part of the conversation is read, by Sonnet 5.5 at low effort.

### Remembers where you stopped

<img src="docs/assets/resume.svg" width="900" alt="Animation: after /clear, the next conversation is told the last task, its state and the next step">

### Catches the usual slips

<img src="docs/assets/nudges.svg" width="900" alt="Animation: nudges for the same failure twice, for saying done without checking, and for drifting out of your language">

### Guards you approve, one panel for everything

`/handoff guard suggest` turns a rule that keeps coming up into a check on tool calls, and nothing applies until you approve it. `/handoff panel` opens a panel above the prompt for guards, memories, rules, the latest notes update and every setting.

<img src="docs/panel.png" width="560" alt="The panel above the prompt, on the Rules tab, listing rules with how many times each came up. Text in Traditional Chinese.">

## Settings

Everything is on the panel's Settings tab (`/handoff panel`, then <kbd>5</kbd>), with where each value comes from and a reset button. The defaults are meant to be left alone. The [guide](docs/guide.md#settings) lists every setting.

## Cost and privacy

- **No servers of its own.** It runs on your Claude Code sign-in and sends nothing anywhere but Anthropic, like the conversation itself.
- **Small, predictable costs.** A handoff is one request; a cache refresh reads from cache at about a tenth of the input price; a notes update sends only the new part of the conversation. The nudges cost nothing.
- **Plain files you own.** Notes are Markdown in `~/.claude/projects/`. Check what the mod may do with `claude plugin validate`; the [guide](docs/guide.md#cost-privacy-and-permissions) explains every entry.

## Documentation

- [Guide](docs/guide.md): every feature in detail, settings, commands, permissions, supported environments, limitations, troubleshooting and uninstalling.
- [Changelog](CHANGELOG.md): what changed in each version and why it's worth upgrading.
- [Contributing](CONTRIBUTING.md): how to run it from source and send changes. Bug reports and ideas go in [issues](https://github.com/cablate/ctx-handoff-mod/issues/new/choose).
- [Security](SECURITY.md): how to report a vulnerability privately.

## License

[MIT](LICENSE)
