# Story CLI -- AI Agent Instructions

The `story` CLI manages visual novel projects on PajamaDot Story Platform.
It wraps 295 API operations across 30+ command groups.

## Installation

```bash
# Preferred: npm (downloads prebuilt binary from CDN)
npm i -g @pajamadot/story-cli

# From source
cd story-cli && cargo build --release
```

The npm package downloads the correct binary for your platform from
`https://releases.pajamadot.com/cli/v{VERSION}/{target}` during postinstall.

Supported: Windows x64, Linux x64/arm64, macOS x64/arm64.

## Self-Update

```bash
story update            # download + replace binary
story update --check    # just check version
```

## Authentication

```bash
# Interactive (opens browser)
story login

# Non-interactive (CI/agent)
export STORY_TOKEN="sp_live_..."
```

## Agent Wrapper (Recommended in OpenClaw Container)

The container boot script writes secrets to `/root/.openclaw/.env`. If an agent-run subprocess does not inherit the full environment, use the wrapper which loads that file before spawning the `story` CLI:

```bash
node /root/.openclaw/skills/story-cli/scripts/story.cjs health
node /root/.openclaw/skills/story-cli/scripts/story.cjs project list --json
```

## Context

Set active project/story to avoid passing IDs on every call:

```bash
story use project <project-id>
story use story <story-id>
story use  # show current context
```

## Key Commands

### Projects & Stories
```bash
story project create --name "My VN"
story story create --title "Chapter 1" --genre romance
```

### Characters
```bash
story character create --name "Alice" --role protagonist --description "..."
story character add-variant --character-id <id> --name happy
```

### Story Graph (Nodes & Links)
```bash
story node create --type start --title "Begin"
story node create --type scene --title "Opening"
story node create --type end --title "Good Ending"
story link create --from <a> --to <b> --choice-text "Go left"
```

### Dialogue
```bash
story dialogue add --node-id <id> --character-id <cid> --text "Hello!" --variant happy
story dialogue get --node-id <id>
```

### Locations & Items
```bash
story location create --name "School Rooftop" --description "..."
story item create --name "Love Letter" --item-type key_item
```

### Variables & Conditions
```bash
story var create-set --name "Love Points"
story var create --variable-set-id <id> --name love --type number --default "0"
story var set-conditions --node-id <id> --conditions '[{"variable":"love","op":">=","value":5}]'
```

### AI Generation
```bash
story generate portrait --character-id <id>
story generate background --location-id <id>
story generate world  # generate everything
story generate cover
```

### AI Writing
```bash
story ai generate-story --prompt "A romance set in a magic academy" --genre romance
story ai dialogue --node-id <id>
story ai suggest-choices --node-id <id>
```

### Publishing & Export
```bash
story publish validate
story publish run
story export json > story.json
story export renpy > script.rpy
```

### Graph & Simulation
```bash
story graph issues    # detect problems
story graph fix       # auto-fix
story simulate qa     # auto-play all branches
```

## End-to-End Workflow

```bash
story login
story project create --name "Summer Romance"
story use project <id>
story story create --title "Sunlit Days" --genre romance
story use story <id>

# Create entities
story character create --name "Hana" --role protagonist
story location create --name "School Rooftop"
story style create --name "Anime" --preset anime

# Generate art
story generate portrait --character-id <id>
story generate background --location-id <id>

# Build graph
story node create --type start --title "Begin"
story node create --type scene --title "Meeting"
story node create --type end --title "Happy Ending"
story link create --from <start> --to <meeting>
story link create --from <meeting> --to <ending>

# Add dialogue
story dialogue add --node-id <meeting> --character-id <hana> --text "Hello!"

# Validate and publish
story publish validate
story publish run
story export renpy > script.rpy
```

## Tips

- All commands support `--json` for machine-readable output
- Use `story health` to check API connectivity (no auth required)
- Use `story update` to update to latest version
- Use `story credits balance` to check remaining generation credits
- Environment variables: `STORY_TOKEN`, `STORY_API_URL`, `STORY_ASSET_URL`, `STORY_GENERATION_URL`, `STORY_AUTH_URL`, `STORY_CDN_URL`, `STORY_OAUTH_CALLBACK_TIMEOUT_SECS`
