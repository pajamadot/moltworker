---
name: pajamadot-story
description: Connect to PajamaDot Story Platform via the `story` CLI (projects, stories, nodes, publishing). Requires STORY_TOKEN.
---

# PajamaDot Story

This skill gives the agent access to your PajamaDot Story workspace via the `story` CLI.

## Prerequisites

- `STORY_TOKEN` (required): token like `sp_live_...`
- Optional: `STORY_API_URL` (defaults to `https://api.pajamadot.com`)

## Quick Start

Check the CLI is installed:

```bash
story --version
```

List projects:

```bash
node {baseDir}/scripts/story.cjs project list --json
```

Set the active project/story (so you can omit IDs on later commands):

```bash
node {baseDir}/scripts/story.cjs use project <project-id>
node {baseDir}/scripts/story.cjs use story <story-id>
```

Create a project + story:

```bash
node {baseDir}/scripts/story.cjs project create --name "ClayClaw VN" --description "ClayClaw story workspace"
node {baseDir}/scripts/story.cjs story create --title "Chapter 1" --genre romance
```

## Notes

- The `story` CLI is installed in the container image; the wrapper script just checks `STORY_TOKEN` and forwards arguments.
- For full CLI docs, see the `story-cli` skill.
