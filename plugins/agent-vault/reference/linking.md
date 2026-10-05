# Linking doctrine — how to wire a concept into the graph

The vault combines an **OKF v0.2 Markdown bundle** with SQLite-backed task concepts provided by the Agent Vault task extension. Both participate in one logical graph. Links make related information easier to retrieve; they are not prerequisites for carrying out a requested write, edit, move, or status change.

## Connect what is genuinely related

Add useful links when the relationship is known, and explain why it matters. Use directory indexes to make file concepts discoverable. If no relevant neighbour exists, save the supported content without inventing one or asking the user to resolve a linking requirement. Missing inbound or outbound links do not make the requested work incomplete.

- **Notes, documents, and decisions** benefit from topic relationships and directory index entries. Maintain those as part of the relevant write when useful, without imposing link counts or unrelated graph repairs.
- **Tasks** are discoverable through the database-backed task board. Link supporting concepts when known; creation, editing, and status moves are independent of those links.
- **Journals and handoffs** are discovered through chronology and resume-point listings. They can link to the work they describe without needing reciprocal topic links.

Graph maintenance can surface opportunities to improve retrieval. Its findings do not block unrelated requested work.

## Link syntax

Use standard Markdown link notation, never `[[wikilinks]]`. File concepts use bundle-relative absolute paths; task concepts use immutable task URIs:

```markdown
decided in [token rotation](/docs/decisions/ADR-005-token-rotation.md)
see [the convention scan note](/knowledge/convention-scan.md)
continue [the task](task:123e4567-e89b-42d3-a456-426614174000)
```

Relative file links are legal but discouraged. A task URI never contains its status or display key and therefore never changes during workflow transitions, title edits, or project transfers.

OKF semantics: a link from A to B asserts *a relationship*; the **kind** of relationship lives in the surrounding prose ("supersedes", "depends on", "contradicts"), not in the link itself. So always frame the link with a word that says why it's there.

Broken links are legal (OKF consumers must tolerate them). A forward link can mark an intended concept; it does not authorize creating that concept or expanding the current task.

## What to link (link the nouns, not the filler)

Link the distinctive entities future-you would *traverse to*:

- a **decision** → `[...](/docs/decisions/ADR-NNN-slug.md)`
- a **task** → `[...](task:<uuid>)`
- another **note** → `[...](/knowledge/<topic>.md)`
- a **doc** → `[...](/docs/<topic>.md)`
- a **journal entry** → `[...](/journal/YYYY-MM-DD.md)`

Do **not** link every word. Over-linking is noise; link the entities, not the connective tissue.

## Unlinked mentions — the highest-value reflex

When your prose names an existing concept and the connection helps a future reader, link the mention. Prefer meaningful navigation over mechanically linking every name. `agent-vault:weave` can review missed connections when graph maintenance is requested.

## Aliases

A concept MAY declare its common alternate names in frontmatter:

```yaml
aliases: [token rotation, key rotation, cred refresh]
```

These are alternate display names for the same concept. Adding them powers richer unlinked-mention detection — `agent-vault:weave` matches prose against a concept's aliases as well as its id/name, so a mention written under a different name still resolves — and lets a writer link or recall the concept under either name. Add aliases when a concept is routinely called by more than one name; keep the list to the names that actually show up in prose, not every synonym.

## Direction & reciprocity

Links are directional and not always symmetric, but **hubs aggregate their inbound**:

- **MOCs / `index.md`** list file concepts; the task board is the synthesized index for database task concepts.
- **ADRs** collect the tasks and notes that depend on them; when note→ADR is "explains this decision", add ADR→note under the ADR's `## Links`.
- **supersession chains** are bidirectional: the new ADR links the old; the old ADR's OKF lifecycle `status` becomes `deprecated`, its `decision_status` becomes `superseded by ADR-NNN`, and it links forward.
- **journal → everything**: the journal is the densest hub. It links out freely and is rarely linked back to (that's correct — it's a timeline, not a topic).

## Applying the guidance

Use exact bundle paths for file links and immutable task URIs for task links. Keep the relationship clear in the surrounding prose, and update relevant index entries when adding or changing file concepts. Preserve existing useful links during edits. None of this requires an unrelated cleanup pass before fulfilling the user's request.
