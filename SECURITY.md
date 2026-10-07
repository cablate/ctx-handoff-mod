# Security

## Reporting a vulnerability

Please report security problems privately through [GitHub's private vulnerability reporting](https://github.com/cablate/ctx-handoff-mod/security/advisories/new), not in a public issue. This is a one-person project, so there's no promised response time, but reports are read.

Only the latest commit on `main` is supported.

## What this mod can do

ctx-handoff is a Claude Code mod. Mods aren't sandboxed: it runs inside Claude Code with your permissions. It reads your conversation, sends parts of it to Anthropic's models through your own Claude Code sign-in, writes its notes file, and sees every tool call (to apply guards you approved). It makes no other network requests and starts no programs.

See [Cost, privacy and permissions](README.md#cost-privacy-and-permissions) for what it sends and stores, and how to check its permissions yourself with `claude plugin validate`.
