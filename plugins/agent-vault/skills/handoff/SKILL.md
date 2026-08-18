---
name: handoff
description: >-
  Write a forward-looking resume-point for unfinished work — the exact state and the first move so
  the next session picks up cold. Use when the user calls the end of a session with work NOT done
  ("write a handoff", "hand this off", "stopping for the day"), or proactively when a session is
  ending mid-work. Distinct from agent-vault:journal — the journal is the backward-looking diary; a
  handoff is the forward-looking pointer to where to resume.
---

# agent-vault:handoff

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

**A handoff is a resume-point for unfinished work.** Its only job: when you sit back down — next session, tomorrow, or after context loss — you pick up cold without re-deriving the volatile working state you'd otherwise have to reconstruct from scratch.

Reader is future-you with the working memory wiped. Written by the agent from what actually happened; not dictated by the user.

## Handoff vs. journal — don't conflate them

| | journal | handoff |
|---|---|---|
| direction | backward — what happened | forward — what to do next |
| lifespan | permanent, accretes | consumed once on resume; superseded by the next |
| written when | end of any substantive session | end of session **with work unfinished** |
| answers | "what was I doing last week" | "where exactly do I pick up" |

If the work is **done**, you don't write a handoff — you journal it and close the task. A handoff exists because something is mid-flight.

You may write both in one wrap-up: the journal records the narrative, the handoff records the resume-point. They link to each other (bundle-relative markdown links — see `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md`); they do not duplicate.

## When to write

- User calls the end of a session and the work isn't finished: "write a handoff", "hand this off", "stopping for the day", "create a handoff".
- Proactively, when a session is clearly ending mid-work and context is about to be lost — offer it, then write it. Don't write a handoff for finished work.

## Automatic pre-compaction handoffs

Context loss doesn't only happen at the end of a session — it happens **mid-session every time the conversation is compacted**, manually via `/compact` or automatically when the context window fills. That auto-compaction is exactly the moment a handoff is most valuable and least likely to be remembered, because no one chose to stop.

The plugin handles this with a **PreCompact hook** (`bin/hook-precompact-handoff.sh`, wired in `.claude-plugin/plugin.json` for Claude Code and `hooks.json` for Codex). A PreCompact hook gets no follow-up agent turn, so it can't ask the running agent to write a handoff — there's no turn left to act on a reminder. Instead it spawns a **headless `codex exec`** that:

1. Reconstructs the session from the transcript on disk (it has no in-session memory — it reads the recent tail of `transcript_path`).
2. Runs this skill against that reconstruction, following the same discipline below — including *writing nothing* if nothing is genuinely in flight.

It runs synchronously, so compaction blocks until the handoff is written from the full pre-compaction transcript (a handoff produced after the context is gone would have nothing to describe). The result lands in `handoffs/` like any other handoff and surfaces as the resume-point at the next SessionStart.

Two consequences for you, the agent, to keep in mind:

- **You may find a recent `handoffs/*.md` you don't remember writing.** It was written by the headless pre-compaction run, on your behalf. Treat it like any handoff: read it on resume, verify against reality, supersede it with a fresher one when you stop.
- **This is best-effort hook behavior.** It depends on the `codex` CLI being on `PATH` and the runtime emitting a PreCompact event; outside a tracked project, without the CLI, or without that event, it silently no-ops. Don't rely on it as a substitute for writing a deliberate handoff when *you* call the end of a unit of work — it's a safety net for the unplanned compaction, not the primary path.

## Writing the handoff — silent path

1. Resolve vault + project via `${AGENT_VAULT_PLUGIN_ROOT}/bin/find-vault.sh` and `resolve-project.sh`. If the project isn't tracked, say so and offer `agent-vault:bootstrap`.
2. Filename: `handoffs/$(date +%Y-%m-%d-%H%M).md`. Always a new dated file — handoffs are never appended to; each is a fresh snapshot. History is kept so you can see how a unit of work evolved across stops.
3. Resolve the writing session's id for the frontmatter: `$CLAUDE_SESSION_ID` if set, else the cache file the SessionStart hook stashed — `"${TMPDIR:-/tmp}/agent-vault-cache/session-$(git rev-parse --show-toplevel | tr -d '\n' | shasum | cut -c1-12)"` — else `unknown`. The tag is how a future session distinguishes which conversation produced which handoff when timestamps cluster.
4. Start from `${AGENT_VAULT_PLUGIN_ROOT}/templates/handoff.md` and substitute every placeholder:
   - `{{DATETIME}}` — human display, e.g. `2026-06-06 14:30`; `{{TIMESTAMP}}` — full ISO 8601 with timezone for `generated.at`; `{{DATE}}` — the journal link target.
   - `{{SESSION_ID}}` — the id from step 3.
   - `{{DESCRIPTION}}` — one line, ≤100 chars, naming the unit of work and the next move (e.g. `Token-refresh mid-build; next: replace stub in refresh.ts:42`). This line IS the handoff's entry in the SessionStart index — a future session decides whether to open the file based on it alone, so make it carry the goal, not vibes.
   - OKF lifecycle `status: stable` and workflow `handoff_status: live` stay as-is at write time.
5. Fill the body from session activity.
6. While writing a fresh handoff, mark prior handoffs for the **same unit of work** as superseded — run `${AGENT_VAULT_PLUGIN_ROOT}/bin/mark-handoff-spent.sh <project-path> <handoff-id>` for each. It sets lifecycle `status: deprecated` and workflow `handoff_status: spent` while preserving the body. Handoffs for other in-flight units stay `handoff_status: live`.
7. **Commit it for durability.** Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh "docs(vault): handoff <id>" <handoff-file> [<superseded-handoff-file(s)>]` — a scoped commit of the handoff you wrote plus any you just marked spent (never `git add -A`, no co-author trailer, silent skip if the vault isn't a git repo or no shell is available).

## What to record

Write from your own observation of the session. Every section earns its place by lowering the cost of resuming — if it doesn't, cut it.

- **Goal** — the unfinished unit of work and its destination, one or two lines. Link the task with its immutable URI (`[task](task:<uuid>)`).
- **State right now** — the boundary between done and not-done. What works, what's half-built, what's broken. Be concrete: "auth middleware lands and is tested; the token-refresh path is stubbed and returns 200 unconditionally."
- **Next step** — the single most important line: the exact first action on resume. Not a backlog — the *first move*. "Replace the stub in refresh.ts:42 with a real call to the token endpoint; the client is already wired."
- **Then** — the remaining moves after that, brief. Enough to see the path, not a full plan.
- **Watch out** — the most perishable, highest-value content: what you figured out the hard way, the trap, the load-bearing assumption. This is the re-derivation you're saving future-you from. "The test harness mocks the clock — refresh logic that reads wall-time will pass tests and fail in prod."
- **Open questions / blockers** — decisions not yet made, things waiting on external input. Link ADRs (`[ADR](/docs/decisions/ADR-NNN-slug.md)`) where a decision is pending.
- **Where things are** — branch, committed-vs-uncommitted state, files in flight, how to verify it runs. Pointers so resume doesn't start with a hunt.

Omit any section with nothing real to say. A handoff padded with empty headings reads as "nothing in flight" and defeats its purpose.

## Wikilinks

Reference the task (`[task](task:<uuid>)`), the session's journal entry (`[2026-06-12](/journal/2026-06-12.md)`), pending ADRs (`[ADR](/docs/decisions/ADR-NNN-slug.md)`), and relevant notes (`[topic](/knowledge/topic.md)`). Use immutable task URIs for tasks and bundle-relative Markdown links for file concepts; never use `[[wikilinks]]`.

## Reading the handoff — the resume path

The SessionStart preamble carries an **index** of recent live handoffs — name, session tag, age, description one-liner, plus staleness signals (over ~14d old; linked database task now done). Nothing is pre-loaded; choosing what to read is your job.

1. Pick the handoff whose description matches the work being resumed — usually the newest, but the index exists precisely because newest isn't always right. Skip entries flagged as likely spent.
2. Read that file in full — it's the densest single source of "where am I."
3. Verify it against reality before acting on it: the branch may have moved, the stub may already be filled, a blocker may be resolved. A handoff reflects the moment it was written, not necessarily now.
4. Once the unit of work it describes is finished, mark it spent so the index stops surfacing it — `${AGENT_VAULT_PLUGIN_ROOT}/bin/mark-handoff-spent.sh <project-path> <handoff-id>` sets `handoff_status: spent` and lifecycle `status: deprecated`. Don't delete it — history shows how the unit evolved across stops. The index has an explicit read-only fallback for v0.1 handoffs whose workflow state still lives in `status`; all new writes use v0.2 fields. If you resume from a handoff and discover it was already dead, mark it spent on the spot.

## What you do not do

- **Don't write a handoff for finished work.** Done work is journaled and the task is closed. A handoff with no unfinished unit is noise.
- **Don't ask the user "what should I write."** You watched the session. Write the resume-point you'd want.
- **Don't duplicate the journal.** The journal is the narrative; the handoff is the next-move. Link, don't copy.
- **Don't append to an existing handoff.** Each stop gets a fresh dated file.
- **Don't auto-promote "then" steps into tasks.** Surface them in the handoff; tracking them as backlog is an explicit `agent-vault:capture` invocation.
- **Don't write to a global handoff.** Project-scoped, like everything else in the vault.
