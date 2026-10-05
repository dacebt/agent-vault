---
title: "Refresh cadence: debounce window — tune the 300ms default"
type: task
priority: low
tags: [server, watch]
created: 2026-06-15
---

The filesystem watcher debounces change events by 300ms before broadcasting
to connected clients. Confirm that window still feels responsive once the
vault has more than a couple of active projects.
