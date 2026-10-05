---
title: Graph link cases
type: note
---

# Graph link cases

The graph includes [the architecture note](./architecture.md) and the
[multi-vault task](/tasks/backlog/VV-01-multi-vault-support.md?view=graph#context).
It also resolves [a reference link][architecture] and a
[literal percent path](./%252e%252e/note.md).

It excludes a [missing note](./missing.md), an
[external destination](https://example.com/outside.md), a
[protocol-relative destination](//example.com/outside.md), a
[local fragment](#graph-link-cases), a
[cross-project traversal](../../fixture-beta/tasks/todo/VV-11-status-column-config.md),
an [encoded traversal](%2e%2e/%2e%2e/fixture-beta/tasks/todo/VV-11-status-column-config.md),
and a [malformed destination](bad%ZZ.md).

![An asset, not a concept link](../artifacts/preview.svg)

`[Inline code is not a link](./architecture.md)`

```markdown
[Fenced code is not a link](./architecture.md)
```

<a href="./architecture.md">Raw HTML is not a Markdown link</a>

[architecture]: ./architecture.md "Architecture note"
