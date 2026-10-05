# Not a project

This directory deliberately has no `tasks/` child. The viewer only counts a
directory as a project when it contains one, so this exists to give that rule
something real to skip instead of going unexercised. It must never appear in
`/api/projects` or any board response.
