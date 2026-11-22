---
name: review
description: Sort the background notes ctx-handoff has collected for this project into the places that enforce them (tools, checks, project rule files), then clear them from the notes file. Use when a new conversation says notes are waiting (inject_mode inbox), when the notes file has grown long, or when the user asks to review or clean up ctx-handoff notes.
---

# Review ctx-handoff notes

The notes file is an inbox, not a rulebook. A note that keeps living there gets loaded into every conversation but is enforced by nothing. This review moves each note to where it actually works and empties the file.

## 1. Read

Open the project's notes file (the path is in the `[ctx-handoff 專案經驗]` line at the start of the conversation). Read every memory, rule and procedure. Also read the project's `CLAUDE.md` / `AGENTS.md` and any rule or check the note may already be covered by.

## 2. Triage every entry into exactly one of three

| Route | When | What to do |
|---|---|---|
| **Harden** | A program can tell whether it was done right: a file exists, a command was used, a format holds, a test passes | Turn it into a tool default, alias, test, lint or hook in the project. The error message says what to use instead. Then delete the note |
| **One line** | No program can tell (a preference, a product boundary, a tone) | Condense to one sentence in the project's or the right subfolder's `CLAUDE.md` / `AGENTS.md`, with one short example of the mistake. Then delete the note |
| **Delete** | One-off, already stale, or already covered by an existing rule, tool or check | Delete the note |

Do not keep a note "just in case": if it is worth keeping it belongs in one of the first two routes.

## 3. Show the table, then wait

Give the user one table: entry, route, the exact destination (file and line, or the tool to change), and for **Harden** how you will check it works. Do nothing until the user confirms. Changes to rule files, new hooks and deletions are theirs to approve.

## 4. Apply and clear

Make the confirmed changes, run the project's related tests or checks, and replay the original mistake once where you hardened something. Then remove the handled entries from the notes file. Report: entries before and after, and what went where.

If the project has its own retrospective method (for example a `work-retro` skill), you can run this review as part of it instead.
