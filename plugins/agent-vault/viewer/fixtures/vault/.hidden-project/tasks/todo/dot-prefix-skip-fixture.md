---
title: Hidden project task (dot-prefix skip fixture)
type: task
priority: low
tags: [fixture]
created: 2026-06-20
---

This task exists only to prove `listProjects` skips dot-prefixed directories
even when they contain a well-formed `tasks/` tree. It must never appear in
`/api/projects` or any board response.
