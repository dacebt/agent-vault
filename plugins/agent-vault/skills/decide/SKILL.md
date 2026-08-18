---
name: decide
description: >-
  Silently record an architectural decision (ADR) — a choice with consequences worth explaining to
  future-you — and wire it into the decision graph. Use when the user says "let's decide", "ADR
  for X", "we chose X over Y", "lock this in", or when a meaningful choice has just been settled
  in conversation. Writes from context already in hand; the user corrects the framing after.
  Non-choices (facts, conventions) are notes — use agent-vault:capture.
---

# agent-vault:decide

Before using bundled files, set `AGENT_VAULT_PLUGIN_ROOT` to the plugin root two levels above the directory containing this loaded `SKILL.md`. Resolve it from the loaded skill path on every invocation; do not assume a checkout path or rely on a host-specific plugin-root variable.

Capture the *why* behind a choice that has consequences. **Silent and agent-driven** — write from the context you already have. An ADR is a **hub** in the OKF graph: tasks depend on it, later ADRs supersede it. Under-linking an ADR is the costliest orphan, so linking is a gate here, not a footnote.

## When to write an ADR

- The user explicitly asks ("ADR this", "lock this in", "record the decision").
- A meaningful choice has just been settled **in conversation** — write it without asking. The conversation carries the real material: constraints discussed, alternatives named, choice made.

**Never write an ADR from commit logs or git history alone.** Commit subjects describe *what* changed, not *why* it was chosen, what alternatives were on the table, or what consequences were anticipated. Fabricating those from commit text produces hollow ADRs — noise. The same applies to inferring decisions from code patterns: the code shows the choice, not the deliberation. If the human-grounded material isn't there, capture observable structure as a `knowledge/` note instead.

## What earns an ADR

ADR-worthy: a choice that closes off other paths (technology, architectural direction, vendor); a choice where the *alternatives mattered*; a choice other tasks/decisions will depend on.

Not ADR-worthy (capture as a note or doc): "we use TypeScript here" (no real alternative); naming conventions (`knowledge/conventions.md`); "the function takes these args" (the code's job).

## Writing the ADR — silent path

1. Resolve vault + project.
2. **Read `${AGENT_VAULT_PLUGIN_ROOT}/reference/linking.md`** — the linking doctrine governs step 7.
3. Generate the ADR id: scan `docs/decisions/` for existing `ADR-NNN-*` files, take the next number. Default `ADR-001`.
4. Slug the title: lowercase, dash-separated, 3–6 words, noun-phrase form ("project-owned bundles, walk-up discovery" — not "should we use one vault?").
5. Filename: `<project>/docs/decisions/ADR-<NNN>-<slug>.md`.
6. **Use `${AGENT_VAULT_PLUGIN_ROOT}/templates/adr.md`** — OKF frontmatter with `type: decision`. Substitute:
   - `{{TITLE}}` — slug-derived title; `{{ADR_ID}}` — the new id.
   - `{{DESCRIPTION}}` — one-sentence summary of the decision (feeds the `docs/decisions/index.md` MOC).
   - `{{DECISION_STATUS}}` — `accepted` if the decision is in effect (the default — the conversation settled and work proceeds under it). `proposed` only if the user explicitly framed it as not-yet-enacted. Don't invent a state; if you aren't sure the decision is real, don't write the ADR.
   - `{{STATUS}}` — the OKF lifecycle value mapped from that workflow state: `stable` for accepted, `draft` for proposed.
   - `{{TIMESTAMP}}` — a full ISO 8601 datetime with timezone.
7. Write Context / Options considered / Decision / Consequences **from the conversation material you already have**. If you're tempted to write `_(TBD)_` in more than one section, you don't have enough for an ADR — capture a `knowledge/` note instead.
8. **Wire the hub (gate).** Under `## Links`, add bundle-relative markdown links:
   - the task(s) this decision constrains — `[auth refactor](task:<uuid>)`
   - related ADRs and the notes that explain or motivated it
   - any existing-concept names in the body get linked, not left bare.
   Then add this ADR to `docs/decisions/index.md` (`* [ADR-NNN: title](/docs/decisions/ADR-NNN-slug.md) — description`) so it earns an inbound link.
9. **Supersession is bidirectional.** If this ADR supersedes a prior one: set the old ADR's lifecycle `status` to `deprecated`, set its `decision_status` to `superseded by ADR-NNN`, add a forward link from the old to the new, and link the old from this one. The chain must stay traceable in both directions.
10. **Commit it for durability.** Run `${AGENT_VAULT_PLUGIN_ROOT}/bin/vault-commit.sh "docs(vault): ADR-<NNN> <slug>" <adr-file> <docs/decisions/index.md> [<superseded-adr-file>]` — a scoped commit of every ADR and index file you changed (never `git add -A`, no co-author trailer, silent skip if the vault isn't a git repo or no shell is available).
11. Tell the user the ADR was written — one line with the path. Not a question.

## Workflow state and OKF lifecycle

- `decision_status: proposed` pairs with `status: draft`.
- `decision_status: accepted` pairs with `status: stable`.
- `decision_status: rejected` pairs with `status: deprecated`.
- `decision_status: superseded by ADR-NNN` pairs with `status: deprecated`; keep the old file so the chain stays traceable.

Never place decision workflow values in the standardized OKF `status` field.

## What you do not do

- **Don't ask the user "what were the options / consequences"** — extract from the conversation you already have.
- **Don't ask permission to record a decision** — if it crossed your awareness as a decision, write it.
- **Don't write ADRs for non-choices** — facts, conventions, defaults are notes.
- **Don't use `[[wikilinks]]`** — OKF-native markdown links only.
- **Don't leave an ADR unlinked.** A decision nothing points to and that points to nothing is invisible to recall.
