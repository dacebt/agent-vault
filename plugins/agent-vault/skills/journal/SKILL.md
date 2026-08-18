---
name: journal
description: >-
  Silently append a per-project dated journal entry from the session's substantive work — what got
  done, stuck, learned, queued. Use when the user says "wrap up", "log what we did", "journal
  this", "leave a breadcrumb", or when significant work just landed. Also the read path for "what
  was I doing last week" / "when did I figure out X". Backward-looking dated diary — the
  forward-looking resume-point is agent-vault:handoff.
---

# agent-vault:journal

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

**Agent-written. Silent.** The journal is the agent's session memory — granular dated narrative that connects sessions. Write from what actually happened in this session; don't interview the user about it.

## When to write

- User explicitly says "wrap up" / "log what we did" / "journal this"
- Significant work has just landed (commit made, decision recorded, problem solved) — write a journal line silently as a side effect, without waiting to be asked
- End of a substantive working session, before context loss

## Writing the entry — silent path

1. Resolve vault + project. Today's filename: `journal/$(date +%Y-%m-%d).md`.
2. Resolve the writing session's id: `$CLAUDE_SESSION_ID` if set, else the cache file the SessionStart hook stashed — `"${TMPDIR:-/tmp}/agent-vault-cache/session-$(git rev-parse --show-toplevel | tr -d '\n' | shasum | cut -c1-12)"` — else `unknown`. Use the first 8 characters.
3. If the file exists, append under a `## <HH:MM> — session <id8>` sub-heading. The session tag is how later recall distinguishes which conversation produced which entry; don't omit it. Advance `generated.at` to the append time.
4. If new, start from `${AGENT_VAULT_PLUGIN_ROOT}/templates/journal-entry.md` with `{{DATE}}` and `{{TIMESTAMP}}` substituted; the timestamp is full ISO 8601 with timezone. Fill the body under the same session sub-heading.
5. **Commit it for durability.** Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh "docs(vault): journal <YYYY-MM-DD>" <journal-file>` — a scoped commit of just the file you wrote (it never `git add -A`s, adds no co-author trailer, and silently skips if the vault isn't a git repo or no shell is available).

## What to record

Write from your own observation of the session. Don't ask the user to dictate.

- **What got done** — concrete: "Rewrote capture skill to remove interrogation; updated bootstrap to extract from repo." Not "worked on capture."
- **What got stuck or surprised** — gnarly bits, dead ends, places the mental model of the problem changed. The most recall-valuable content.
- **What was decided** — link to ADRs (`[the decision](/docs/decisions/ADR-NNN-slug.md)`); if a decision was made but not yet ADR'd, capture it as a placeholder line so it isn't lost.
- **What's queued for next time** — the handoff to future-you. "Next: smoke test the silent capture flow against the live project."
- **Commits made** — short SHAs are auto-linked into tasks by the PostToolUse hook; the journal can summarize at higher level ("two commits ago we shipped X").

If a section has nothing real to say, omit it. Empty journal sections rot.

## Links

The journal is where the OKF graph gets densest — that's what makes recall actually work. Link with **bundle-relative markdown links**, never `[[wikilinks]]` (see `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md`):

- tasks — `[auth refactor](task:<uuid>)`
- ADRs — `[token rotation](/docs/decisions/ADR-005-token-rotation.md)`
- notes — `[the convention scan](/knowledge/convention-scan.md)`
- prior journal entries — `[2026-06-12](/journal/2026-06-12.md)`

Link freely — the journal is the hub that points at everything; it's rarely linked back to, and that's correct (it's a timeline, not a topic).

## Reading the journal

Read path: when the user asks "what was I doing last week" / "when did I figure out X" / "show me the journal", read the relevant entries and surface them. Quote selectively; don't dump full bodies. For deeper recall, delegate to `agent-vault:recall` so the question can route across more than just the journal.

## What you do not do

- **Don't ask the user "what should I write" for the journal.** You watched the session happen. Write what you observed.
- **Don't fabricate session activity** that didn't actually happen.
- **Don't auto-promote "things to do next" into tasks.** Surface them in the journal; if the user wants them tracked as backlog, that's a `agent-vault:capture` invocation with explicit user intent.
- **Don't write to a global journal.** This is project-scoped. Cross-project narratives are not this skill's job.
