---
type: decision
title: >-
  {{TITLE}}
description: >-
  {{DESCRIPTION}}
status: {{STATUS}}
decision_status: {{DECISION_STATUS}}
tags: [decision]
generated:
  by: agent-vault/okf-v0.2
  at: "{{TIMESTAMP}}"
---
# {{ADR_ID}}: {{TITLE}}

## Context
_(what's the situation that forced a decision — the constraints, the prior state, who's affected)_

## Options considered
_(at least two. Naming an option you rejected matters as much as the one you chose — future-you needs to know "yes I thought about X and ruled it out because Y")_

- **Option A**: ...
- **Option B**: ...

## Decision
_(the choice, stated plainly)_

## Consequences
_(what this commits us to, what gets harder, what new questions open up)_

## Links
_(an ADR is a hub — wire it densely. Bundle-relative markdown links:_
_`- [the task this decided](task:<uuid>)`_
_`- supersedes [the older choice](/docs/decisions/ADR-003-token-store.md)`_
_When this supersedes a prior ADR, set that ADR's `status` to `deprecated`, set `decision_status` to `superseded by {{ADR_ID}}`, and add a return link.)_
