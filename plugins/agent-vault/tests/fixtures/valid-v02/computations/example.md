---
type: Attested Computation
title: Example computation
status: stable
runtime: python
parameters:
  - name: value
    type: integer
    required: true
executor:
  resource: /references/run.md
  receipt: [result]
attester:
  resource: /references/attest.py
computation: /references/compute.py
---
# Definition

Returns the supplied value.
