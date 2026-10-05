# Architecture note

The viewer is a single Node process: a plain HTTP server projects the
vault's task directories into JSON, and a vanilla JS frontend renders the
board and document modal from that projection. There is no build step and
no framework — `marked` is the only vendored dependency.
