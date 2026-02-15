---
name: story-cli
description: Use the Rust `story` CLI to authenticate (OAuth PKCE) and manage visual novel projects on PajamaDot Story Platform. Covers all 295 MCP tools - projects, stories, nodes, characters, locations, dialogue, variables, generation, publishing, export, simulation, and more. Preferred over curl/MCP for scripting and agent workflows.
tags: [cli, oauth, pkce, visual-novel, story, mcp, generation, publishing]
---

# Story CLI Skill

Use the `story` CLI for end-to-end visual novel creation and management against the PajamaDot Story Platform API (api.pajamadot.com).

This is the preferred interface for scripts and agents:

- Web login handled once via OAuth PKCE
- All subsequent operations use `Authorization: Bearer sp_live_...`
- Supports all 295 MCP tools across 30+ command groups
- Auto-injects active project/story context
- All commands support `--json` flag for machine-readable output

## Install

```powershell
# npm (downloads prebuilt binary from CDN automatically)
npm i -g @pajamadot/story-cli

# Build from source
cd story-cli && cargo build --release

# Or cargo install
cargo install --path story-cli --force
```

## Agent Wrapper (OpenClaw Container)

In this `moltworker` container image, the `story` CLI is preinstalled. The container boot script also writes secrets to `/root/.openclaw/.env`. For agent-run subprocesses that may not inherit the full environment, use the wrapper:

```bash
node /root/.openclaw/skills/story-cli/scripts/story.cjs health
node /root/.openclaw/skills/story-cli/scripts/story.cjs project list --json
```

### How npm Install Works

The npm package is a thin shim (`bin/story.js`) + `postinstall.js`. At install time, postinstall downloads the platform-correct binary from `https://releases.pajamadot.com/cli/v{VERSION}/{target}`, verifies the SHA256 checksum, and places it in `bin/`. No native compilation needed.

Supported platforms: Windows x64, Linux x64/arm64, macOS x64/arm64.

### Self-Update

```powershell
story update            # Download and replace binary with latest from CDN
story update --check    # Check for new version without installing
```

The self-update mechanism:
1. Fetches `https://releases.pajamadot.com/cli/latest.json` to get latest version
2. Downloads the platform-specific binary from the CDN
3. Verifies SHA256 checksum
4. Replaces the running binary (Windows: rename trick, Unix: atomic rename)

## Auth

Interactive login (opens browser, OAuth PKCE loopback redirect):

```powershell
story login
```

If the environment can't open a browser:

```powershell
story login --no-open
```

Non-interactive (CI/agent) auth:

```powershell
# Environment variable
$env:STORY_TOKEN = "sp_live_..."
# Or CLI flag
story --token sp_live_... project list
```

Other auth commands:

```powershell
story token       # Print current token
story logout      # Clear stored token
story config-path # Show config file location
```

## Context (Active Project / Story)

Set active project/story so you don't need `--project` / `--story` on every command:

```powershell
story use project <project-id>
story use story <story-id>
story use                       # Show current context
```

Override per-command:

```powershell
story --project abc --story def node list
```

## Command Groups

### Projects

```powershell
story project list
story project create --name "My VN" --description "A visual novel"
story project get <id>
story project update <id> --name "New Name"
```

### Stories

```powershell
story story list
story story create --title "Chapter 1" --genre romance
story story get
story story update --title "Updated Title"
```

### Nodes (Story Graph)

```powershell
story node create --type scene --title "Opening"
story node create --type start --title "Begin"
story node create --type end --title "Good Ending"
story node create --type condition --title "Check Love"
story node create --type hub --title "Town Square"
story node get <id>
story node update <id> --title "New Title" --content "Updated text"
story node list
story node list --type scene
story node search "love confession"
story node duplicate <id>
story node bulk-create --nodes '[{"node_type":"scene","title":"A"},{"node_type":"scene","title":"B"}]'
```

### Links (Connections)

```powershell
story link create --from <node-a> --to <node-b>
story link create --from <node-a> --to <node-b> --choice-text "Go left"
story link list
story link reroute <link-id> --to <new-target>
story link set-scripts <link-id> --conditions '{"variable":"love","op":">=","value":5}'
```

### Characters

```powershell
story character list
story character create --name "Alice" --role protagonist --description "A brave heroine"
story character get <id>
story character update <id> --name "Alice Blackwood"
story character add-variant --character-id <id> --name happy
story character add-variant --character-id <id> --name sad
story character list-variants --character-id <id>
```

### Scenes, Locations, Items

```powershell
story scene list
story scene create --title "Cherry Blossom Park"
story location list
story location create --name "School Rooftop" --description "A peaceful spot"
story item list
story item create --name "Love Letter" --item-type key_item
```

### Dialogue

```powershell
story dialogue add --node-id <id> --character-id <char-id> --text "Hello!" --variant happy
story dialogue get --node-id <id>
story dialogue set --node-id <id> --lines '[{"character_id":"...","text":"Hi"}]'
story dialogue clear --node-id <id>
```

### Scene Characters (Positioning)

```powershell
story scene-char add --node-id <id> --character-id <char-id> --position left
story scene-char position --node-id <id> --character-id <char-id> --position center
story scene-char variant --node-id <id> --character-id <char-id> --variant happy
story scene-char list --node-id <id>
story scene-char swap --node-id <id> --character-a <a> --character-b <b>
```

### Variables & Conditions

```powershell
story var create-set --name "Love Points"
story var create --variable-set-id <id> --name love --type number --default "0"
story var list
story var set-conditions --node-id <id> --conditions '[{"variable":"love","op":">=","value":5}]'
story var set-effects --node-id <id> --effects '[{"variable":"love","op":"add","value":1}]'
```

### Quests & Milestones

```powershell
story quest create --title "Find the Letter"
story quest list
story quest create-objective --quest-id <id> --title "Talk to Alice"
story quest milestones
story quest create-milestone --title "Act 1"
```

### Assets

```powershell
story asset list
story asset get <id>
story asset upload --filename "portrait.png" --content-type image/png
story asset link --asset-id <id> --entity-type character --entity-id <char-id> --role portrait
story asset entity-assets --entity-type character --entity-id <char-id>
```

### Visual Styles

```powershell
story style list
story style create --name "Anime" --preset anime
story style set-default --style-id <id>
```

### AI Generation (Images, Audio)

```powershell
# Character portraits
story generate portrait --character-id <id>
story generate portrait --character-id <id> --variant sad
story generate character-variants --character-id <id> --variants happy,sad,angry

# Scene backgrounds
story generate background --location-id <id>
story generate background --scene-id <id> --prompt "sunset over the ocean"

# Other
story generate image --prompt "fantasy castle" --aspect-ratio 16:9
story generate cover
story generate item-icon --item-id <id>
story generate voiceover --text "Hello, traveler" --character-id <id>
story generate music --prompt "romantic piano" --duration 60
story generate sfx --prompt "door creaking"
story generate upscale --asset-id <id>
story generate variations --asset-id <id> --count 4
story generate world  # Generate everything for the story

# Status
story generate status --generation-id <id>
story generate history
story generate estimate --tool generate_character_portrait
```

### AI Writing Assistance

```powershell
story ai rewrite --content "He was sad" --tone dramatic
story ai expand --content "She walked in" --instructions "Add sensory details"
story ai suggest-choices --node-id <id>
story ai dialogue --node-id <id>
story ai narration --node-id <id>
story ai bio --character-id <id>
story ai next-beat
story ai generate-story --prompt "A romance set in a magic academy" --genre romance
story ai extend-story --from-node <id>
story ai enhance-prompt --prompt "girl with sword" --target character
```

### Publishing

```powershell
story publish run                # Publish the active story
story publish validate           # Check if story is valid
story publish quality            # Deep quality check
story publish check              # Quick readiness check
story publish history            # View publish history
story publish unpublish          # Take story offline
```

### Export

```powershell
story export json > story.json   # Full JSON export
story export ink > story.ink     # Ink format
story export yarn > story.yarn   # Yarn Spinner
story export renpy > script.rpy  # Ren'Py
story export twine > story.html  # Twine
story export yaml > story.yaml   # YAML
story export verse               # Verse format
story export formats             # List all formats
```

### Simulation & Testing

```powershell
story simulate start             # Start playing
story simulate step --simulation-id <id> --choice 0
story simulate status --simulation-id <id>
story simulate paths             # Find all story paths
story simulate qa                # Auto-play all branches
```

### Graph Operations

```powershell
story graph issues               # Detect problems
story graph fix                  # Auto-fix issues
story graph layout               # Auto-layout nodes
story graph paths                # Get all paths
story graph render               # Render graph image
story graph verify               # Verify integrity
story graph diagnose             # Full diagnostic
story graph issue-types          # List issue types
```

### Localization

```powershell
story localize get --language ja
story localize translate --target ja
story localize patch --patches '[{"key":"greeting","ja":"..."}]'
```

### Credits

```powershell
story credits balance
story credits pricing
story credits history
story credits estimate --tool generate_character_portrait
```

### Memory (Persistent Agent State)

```powershell
story memory list
story memory get --key "protagonist_mood"
story memory set --key "protagonist_mood" --value "determined"
story memory search --query "love"
```

### Scripts

```powershell
story script list
story script create --title "Act 1 Outline" --script-type outline
story script ingest --script-id <id>  # Convert to story graph
story script methods                  # List custom methods
```

### Story Info

```powershell
story info status     # Overview
story info guide      # Workflow guide
story info digest     # Story summary
story info context    # Query context
```

### Settings

```powershell
story settings cover --asset-id <id>
story settings visibility --visibility public
story settings update --settings '{"theme":"dark"}'
```

### Forks

```powershell
story fork create
story fork list
story fork ancestry
story fork stats
```

### Health & Updates

```powershell
story health            # Check API health (no auth required)
story update            # Update CLI to latest version
story update --check    # Check for updates without installing
```

### Install Agent Skills

```powershell
story init                    # Install skill for Claude Code (default)
story init --agent codex      # Install skill for OpenAI Codex
story init --agent all        # Install for both agents
story init --force            # Overwrite existing files
```

## End-to-End Workflow (Agent Pattern)

Complete VN creation from scratch:

```powershell
# 1. Auth
story login

# 2. Create project
story project create --name "Summer Romance"
story use project <project-id>

# 3. Create story
story story create --title "Sunlit Days" --genre romance
story use story <story-id>

# 4. Create characters
story character create --name "Hana" --role protagonist --appearance "Long black hair, school uniform"
story character create --name "Ryu" --role love_interest --appearance "Tall, messy brown hair"

# 5. Create locations
story location create --name "School Rooftop" --description "Quiet spot overlooking the city"
story location create --name "Cherry Blossom Park" --description "Peaceful park in spring"

# 6. Create style & generate art
story style create --name "Anime" --preset anime
story generate portrait --character-id <hana-id>
story generate portrait --character-id <ryu-id>
story generate background --location-id <rooftop-id>

# 7. Build story graph
story node create --type start --title "Begin"
story node create --type scene --title "Meeting on the Rooftop"
story node create --type scene --title "Walk in the Park"
story node create --type end --title "Happy Ending"
story link create --from <start> --to <meeting>
story link create --from <meeting> --to <walk> --choice-text "Follow her"
story link create --from <walk> --to <ending>

# 8. Add dialogue
story dialogue add --node-id <meeting> --character-id <hana> --text "Oh! I didn't expect anyone here..."
story dialogue add --node-id <meeting> --character-id <ryu> --text "Sorry, I come here to think sometimes."

# 9. Validate & publish
story publish validate
story publish quality
story publish run

# 10. Export
story export json > summer-romance.json
story export renpy > game/script.rpy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STORY_TOKEN` | Auth token (skips config file) |
| `STORY_API_URL` | Override API URL (default: https://api.pajamadot.com) |
| `STORY_ASSET_URL` | Override asset server URL |
| `STORY_GENERATION_URL` | Override generation server URL |
| `STORY_AUTH_URL` | Override auth server URL |
| `STORY_CDN_URL` | Override CDN URL for updates (default: https://releases.pajamadot.com) |
| `STORY_OAUTH_CALLBACK_TIMEOUT_SECS` | OAuth timeout (default: 900) |

## Development

### Project Layout

```
story-cli/
  Cargo.toml              # Rust project (version source of truth)
  src/
    commands/              # All CLI subcommands
    config.rs              # Token/context storage
    update.rs              # Self-update from CDN
    main.rs
  npm/
    package.json           # @pajamadot/story-cli npm package
    bin/story.js           # Thin shim that spawns platform binary
    postinstall.js         # Downloads binary from CDN at install time
  scripts/
    release.ps1            # Windows: build + upload + version bump
    release.sh             # Linux/macOS: build + upload
  dist/                    # Local build artifacts (gitignored)
  tests/
    e2e.rs                 # End-to-end CLI tests
```

### Releasing

Use the `/release` skill for the full flow. Quick summary:

```powershell
.\story-cli\scripts\release.ps1 -Bump patch   # bump, commit, tag, push
# CI builds 5 binaries -> R2 CDN
# then: cd story-cli/npm && npm publish --access public
```

### Building Locally

```powershell
cd story-cli
cargo build --release --target x86_64-pc-windows-msvc
# Binary at: target/x86_64-pc-windows-msvc/release/story.exe
```

## When To Use This Skill

- Creating or managing visual novel projects from the terminal
- Scripting batch operations (create characters, nodes, links in sequence)
- Agent workflows that need to build complete VN games programmatically
- Validating, testing, and publishing stories
- Generating art (portraits, backgrounds, covers) via AI
- Exporting stories to game engine formats (Ren'Py, Ink, Yarn, Twine)
- Quick operations when the web editor is overkill
