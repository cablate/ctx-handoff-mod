# Changelog

Notable changes to ctx-handoff. Versions follow the `version` in `.claude-plugin/plugin.json`.

## Unreleased

### Added

- **Guards:** `/handoff guard suggest` turns a rule that came up 3 times into a check on tool calls (block or remind). Nothing applies until you approve it with `/handoff guard on N`.
- **Panel:** `/handoff panel` opens a panel above the prompt to approve guards, see the latest notes update and delete wrong notes (backed up first).
- The status line counts down to the next notes update and shows when one is running.

### Changed

- Each memory is now a one-line title plus details. Preferences and corrections load in full; facts and locations load as titles only.
- Facts and locations unconfirmed for 30 days are archived (not loaded, not deleted) instead of capping the number of notes.
- Status line, toast and log text no longer repeat the `[ctx-handoff]` prefix.

### Fixed

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
