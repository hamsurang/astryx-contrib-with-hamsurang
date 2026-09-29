---
schema_version: 1
kind: architecture
id: architecture:public-api
authority: current
applies_to: [packages/core/src/, packages/core/src/BaseProps.ts]
verified_by: [packages/core/src/api.test.ts]
---

# Public component API

Every core component accepts BaseProps and passes rest props through.

## Passthrough

Rest props reach the root element.
