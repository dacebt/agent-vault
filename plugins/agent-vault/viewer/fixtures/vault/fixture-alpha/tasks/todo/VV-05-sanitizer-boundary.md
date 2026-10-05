---
type: task
priority: high
tags: [reader, security]
created: 2026-08-11
---

# Verify Markdown sanitizer containment

<p id="sanitizer-safe-sentinel">Safe Markdown content remains visible.</p>

<svg id="sanitizer-svg-bait" xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true">
  <style id="sanitizer-svg-style">#sanitizer-safe-sentinel { display: none !important; }</style>
  <script id="sanitizer-svg-script">document.documentElement.dataset.sanitizerSvgScript = "executed";</script>
  <a id="sanitizer-svg-link" xlink:href="javascript:document.documentElement.dataset.sanitizerSvgLink = 'executed'">
    <text x="0" y="15">safe</text>
  </a>
</svg>

<template id="sanitizer-template-bait">
  <style id="sanitizer-template-style">#sanitizer-safe-sentinel { display: none !important; }</style>
  <script id="sanitizer-template-script">document.documentElement.dataset.sanitizerTemplateScript = "executed";</script>
  <a id="sanitizer-template-link" href="javascript:document.documentElement.dataset.sanitizerTemplateLink = 'executed'">unsafe template link</a>
</template>

<base id="sanitizer-base-bait" href="https://example.invalid/">
<meta id="sanitizer-meta-bait" http-equiv="refresh" content="0;url=https://example.invalid/">

<button id="sanitizer-event-bait" onclick="document.documentElement.dataset.sanitizerEvent = 'executed'">Safe button</button>
<a id="sanitizer-javascript-link" href="javascript:document.documentElement.dataset.sanitizerLink = 'executed'">Sanitized link</a>
<form id="sanitizer-form-bait">
  <button id="sanitizer-formaction-bait" formaction="javascript:document.documentElement.dataset.sanitizerFormaction = 'executed'">Safe form button</button>
</form>
<img id="sanitizer-srcset-bait" alt="Sanitized source set" srcset="javascript:document.documentElement.dataset.sanitizerSrcset = 'executed' 1x, ../../artifacts/preview.svg 2x">

[Open architecture](/knowledge/architecture.md)
