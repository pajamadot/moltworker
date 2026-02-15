---
name: clayclaw-memory
description: Durable game-dev memory via Game Dev Memory (projects + memories). Use for bugfix notes, build failures, profiling results, design decisions, and retrieval-first Q&A. Requires GDM_API_TOKEN.
---

# ClayClaw Memory (Game Dev Memory)

This skill connects OpenClaw/ClayClaw to the Game Dev Memory **Memory API** (the source of truth).

## Prerequisites

- `GDM_API_TOKEN` (required): API key `gdm_...` used as `Authorization: Bearer ...`
- `GDM_API_URL` (optional): defaults to `https://api-game-dev-memory.pajamadot.com`
- `GDM_PROJECT_ID` (optional): default project to use for memory operations

## Quick Start

List projects:

```bash
node {baseDir}/scripts/gdm.js projects list
```

Create a memory:

```bash
node {baseDir}/scripts/gdm.js memories create \
  --project-id "<project-uuid>" \
  --category "bug" \
  --title "Fixed shader compile crash on DX12" \
  --content "Root cause + fix steps..." \
  --tags "dx12,shader,crash"
```

Progressive retrieval (cheap index hits, then fetch full records for selected IDs):

```bash
node {baseDir}/scripts/gdm.js memories search-index \
  --project-id "<project-uuid>" \
  --q "packaging failure" \
  --limit 10
```

```bash
node {baseDir}/scripts/gdm.js memories batch-get \
  --ids "<memory-id-1>,<memory-id-2>" \
  --include-content true
```

## Guidance For The Agent

- Prefer: `memories search-index` -> `memories batch-get` for chosen IDs.
- When writing memories, include: repro steps, root cause, fix, and stable tags.
- Keep retrieval outputs compact unless the user asks for full content.
