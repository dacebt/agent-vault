---
type: task
priority: high
tags: [ui, modal]
created: 2026-06-10
---

# Preview inline images in the task modal

Task cards that link to a doc with an image should show the image inline
when the doc opens, not just as a broken-looking markdown reference.

<img id="vv-02-local-src" src="../../artifacts/preview.svg" alt="board preview">

<img id="vv-02-responsive-img" src="../../artifacts/preview.svg" srcset="../../artifacts/preview.svg 1x, ../../artifacts/preview.svg 2x" alt="responsive board preview">

<picture id="vv-02-responsive-picture">
  <source
    id="vv-02-external-source"
    media="(min-width: 10000px)"
    srcset="https://example.invalid/preview.svg 1x, //example.invalid/preview@2x.svg 2x"
  >
  <source
    id="vv-02-local-picture-source"
    srcset="../../artifacts/preview.svg 1x, ../../artifacts/preview.svg 2x"
  >
  <img id="vv-02-picture-fallback" src="../../artifacts/preview.svg" alt="picture board preview">
</picture>

Acceptance: opening this task's doc renders the preview above through
`/raw/`, not a 404.
