# Decision records

Use this guidance through [capture](../SKILL.md), which owns project resolution,
record selection, and scoped durability.

Preserve why a consequential choice was made and what it commits the project to.
Read the [ADR template](../../../templates/adr.md) and
[linking doctrine](../../../reference/linking.md) before writing the record.

## Evidence and intent

Record a decision when requested or when a meaningful choice has actually been
settled in conversation. Discussion of an option is not adoption. Commit messages
and code can show what exists, but cannot establish the alternatives, reasoning, or
human intent behind it. Use the conversational material already available rather
than interviewing the user to fill a template.

Record only alternatives and consequences supported by that material; there is no
minimum number of options. A fact or convention without decision material belongs
in a knowledge note. If the choice is known but part of its rationale is unknown,
say so instead of supplying a plausible history. Do not create an accepted ADR when
it is unclear whether a decision was made.

## Identity and state

Read existing decisions to avoid duplicating one and to identify any decision being
replaced. Keep later context distinguishable from the original reasoning; a new
explanation must not silently become the purported history of an earlier choice.
New records use the next unused `ADR-NNN` number in `docs/decisions/`,
starting with `ADR-001`, and a descriptive kebab-case filename:
`ADR-NNN-<slug>.md`. Give the record a human-readable title and a one-sentence
summary for its index entry. Fill the template with timezone-aware provenance.

Decision workflow and OKF lifecycle are distinct:

| `decision_status` | `status` |
|---|---|
| `proposed` | `draft` |
| `accepted` | `stable` |
| `rejected` | `deprecated` |
| `superseded by ADR-NNN` | `deprecated` |

Use accepted for a settled choice in effect. Use proposed when the user intends to
record a proposal, not as a way to turn every discussion into a record.

## Connections and replacement

Link the tasks, notes, and decisions that actually bear on the choice. List the new
ADR and its description in `docs/decisions/index.md`. Do not manufacture related
work merely to fill a Links section.

Preserve a prior decision's historical reasoning when a new choice replaces it.
Write a superseding ADR, link it to the old record, and update the old record's
`decision_status` to `superseded by ADR-NNN` and lifecycle `status` to `deprecated`.
Add the forward link so the chain is traversable both ways, and update provenance
and affected index descriptions. The scoped durability commit includes the new ADR,
the old ADR, the index, and any other relationship records actually changed.
