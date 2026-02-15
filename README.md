# OpenClaw on Cloudflare Workers

Run [OpenClaw](https://github.com/openclaw/openclaw) (formerly Moltbot, formerly Clawdbot) personal AI assistant in a [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/).

## PajamaDot Fork (vs `cloudflare/moltworker`)

This repository is a fork of `cloudflare/moltworker`. The upstream project is a minimal proof-of-concept; this fork adds production-focused features and PajamaDot/ClayClaw integrations.

Keep this section updated when we change user-facing behavior (routes, environment variables, startup/persistence behavior, built-in skills).

### High-Level Differences

- **OpenClaw-first + legacy migration**: Uses `.openclaw/` paths and supports restoring/migrating legacy `.clawdbot/` backups.
- **Cold-start readiness UX**: Public `/api/status` endpoint and a loading page that polls until the gateway is ready (avoids hanging admin/auth flows during container boot).
- **Auth improvements**: Supports comma-separated `CF_ACCESS_AUD` values, plus `E2E_TEST_MODE` to skip Cloudflare Access auth without disabling device pairing.
- **Gateway startup hardening**: Non-blocking gateway start + short readiness probes (reduces Durable Object lockups), and a time-bounded `openclaw doctor --fix` during container boot.
- **More channels**: Adds Feishu/Lark support (in addition to Telegram/Discord/Slack), plus pairing endpoints for DM flows.
- **Agent tooling**: Adds `clayclaw-memory`, `pajamadot-story`, and `story-cli` skills, with wrapper scripts that load `/root/.openclaw/.env` for agent subprocesses.
- **Branding + icons**: ClayClaw title/assistant branding and worker-served favicon/app icons used by the Control UI.

<details>
<summary>Detailed upstream delta (key commits ahead of upstream/main)</summary>

#### `8a43496` (2026-02-14) feat: OpenClaw worker upgrades

- **Worker routing + cold-start UX:**
- Added public readiness endpoints (`/api/status`, `/sandbox-health`) and public static asset routing needed during auth/cold-start (`/_admin/assets/*`, favicons).
- Added a loading page that polls `/api/status` so the Control UI can survive cold starts without hanging the sandbox Durable Object.
- Added token-gated status details (`/api/status?details=true&token=...`) for remote log tail debugging without needing Cloudflare Access.
- **Auth + gateway lifecycle:**
- Added `E2E_TEST_MODE` (skip Cloudflare Access auth but keep device pairing).
- Cloudflare Access: support comma-separated `CF_ACCESS_AUD` values (multiple Access applications).
- Hardened gateway start logic to be non-blocking and to use short probes/timeouts to avoid Durable Object contention during startup.
- **Container startup + persistence:**
- Added R2 restore/migration: prefers `openclaw/` prefix, falls back to legacy `clawdbot/` and migrates config on boot.
- Writes a runtime `/root/.openclaw/.env` from container env vars for agent subprocesses; excludes `.env` from R2 sync.
- Time-bounded `openclaw doctor --fix` during startup to avoid infinite hangs.
- OpenClaw config patching at boot: trusted proxies, gateway token auth, Control UI assistant branding, and default skill enablement.
- **Channels + integrations:**
- Added Feishu/Lark env vars + config patching and documented setup.
- Added built-in skills: `clayclaw-memory` (Game Dev Memory) and PajamaDot Story CLI docs/wrappers.
- **Tooling + build hygiene:**
- Added `.dockerignore` and `.gitattributes` (enforce LF for `.sh`); added Control UI icons served by the worker.
- Bumped Wrangler (and regenerated lockfile) as part of the upgrade.

#### `883b22e` (2026-02-15) feat: improve Story CLI agent wrapper

- Added `skills/story-cli/scripts/story.cjs` wrapper that loads `~/.openclaw/.env` before spawning `story`.
- Updated `pajamadot-story` wrapper similarly, and renamed wrappers to `.cjs` to work in this repo's `"type": "module"` setup.
- Updated skill docs to reflect the agent wrapper workflow.

#### `3edfd18` (2026-02-15) chore: bump story-cli to v0.2.4

- Updated the container image to install `@pajamadot/story-cli@0.2.4`.

#### `8131271` (2026-02-15) docs: document PajamaDot fork changes

- Added a fork-diff summary to the README and a reminder in `AGENTS.md` to keep it current.

</details>

![moltworker architecture](./assets/logo.png)

> **Experimental:** This is a proof of concept demonstrating that OpenClaw can run in Cloudflare Sandbox. It is not officially supported and may break without notice. Use at your own risk.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pajamadot/moltworker)

## Requirements

- [Workers Paid plan](https://www.cloudflare.com/plans/developer-platform/) ($5 USD/month) - required for Cloudflare Sandbox containers
- [Anthropic API key](https://console.anthropic.com/) - for Claude access, or you can use AI Gateway's [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)

The following Cloudflare features used by this project have free tiers:
- Cloudflare Access (authentication)
- Browser Rendering (for browser navigation)
- AI Gateway (optional, for API routing/analytics)
- R2 Storage (optional, for persistence)

## Container Cost Estimate

This project uses a `standard-1` Cloudflare Container instance (1/2 vCPU, 4 GiB memory, 8 GB disk). Below are approximate monthly costs assuming the container runs 24/7, based on [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/pricing/):

| Resource | Provisioned | Monthly Usage | Included Free | Overage | Approx. Cost |
|----------|-------------|---------------|---------------|---------|--------------|
| Memory | 4 GiB | 2,920 GiB-hrs | 25 GiB-hrs | 2,895 GiB-hrs | ~$26/mo |
| CPU (at ~10% utilization) | 1/2 vCPU | ~2,190 vCPU-min | 375 vCPU-min | ~1,815 vCPU-min | ~$2/mo |
| Disk | 8 GB | 5,840 GB-hrs | 200 GB-hrs | 5,640 GB-hrs | ~$1.50/mo |
| Workers Paid plan | | | | | $5/mo |
| **Total** | | | | | **~$34.50/mo** |

Notes:
- CPU is billed on **active usage only**, not provisioned capacity. The 10% utilization estimate is a rough baseline for a lightly-used personal assistant; your actual cost will vary with usage.
- Memory and disk are billed on **provisioned capacity** for the full time the container is running.
- To reduce costs, configure `SANDBOX_SLEEP_AFTER` (e.g., `10m`) so the container sleeps when idle. A container that only runs 4 hours/day would cost roughly ~$5-6/mo in compute on top of the $5 plan fee.
- Network egress, Workers/Durable Objects requests, and logs are additional but typically minimal for personal use.
- See the [instance types table](https://developers.cloudflare.com/containers/pricing/) for other options (e.g., `lite` at 256 MiB/$0.50/mo memory or `standard-4` at 12 GiB for heavier workloads).

## What is OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) (formerly Moltbot, formerly Clawdbot) is a personal AI assistant with a gateway architecture that connects to multiple chat platforms. Key features:

- **Control UI** - Web-based chat interface at the gateway
- **Multi-channel support** - Telegram, Discord, Slack
- **Device pairing** - Secure DM authentication requiring explicit approval
- **Persistent conversations** - Chat history and context across sessions
- **Agent runtime** - Extensible AI capabilities with workspace and skills

This project packages OpenClaw to run in a [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) container, providing a fully managed, always-on deployment without needing to self-host. Optional R2 storage enables persistence across container restarts.

## Architecture

![moltworker architecture](./assets/architecture.png)

## Quick Start

_Cloudflare Sandboxes are available on the [Workers Paid plan](https://dash.cloudflare.com/?to=/:account/workers/plans)._

```bash
# Install dependencies
npm install

# Set your API key (direct Anthropic access)
npx wrangler secret put ANTHROPIC_API_KEY

# Or use Cloudflare AI Gateway instead (see "Optional: Cloudflare AI Gateway" below)
# npx wrangler secret put CLOUDFLARE_AI_GATEWAY_API_KEY
# npx wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID
# npx wrangler secret put CF_AI_GATEWAY_GATEWAY_ID

# Generate and set a gateway token (required for remote access)
# Save this token - you'll need it to access the Control UI
export MOLTBOT_GATEWAY_TOKEN=$(openssl rand -hex 32)
echo "Your gateway token: $MOLTBOT_GATEWAY_TOKEN"
echo "$MOLTBOT_GATEWAY_TOKEN" | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN

# Deploy
npm run deploy
```

PowerShell (Windows) token generation alternative:

```powershell
# Generate a random 32-byte hex token (64 hex chars)
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''

$token | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN
Write-Host "Your gateway token: $token"
```

After deploying, open the Control UI with your token:

```
https://your-worker.workers.dev/?token=YOUR_GATEWAY_TOKEN
```

Replace `your-worker` with your actual worker subdomain and `YOUR_GATEWAY_TOKEN` with the token you generated above.

**Note:** The first request may take 1-2 minutes while the container starts.

> **Important:** You will not be able to use the Control UI until you complete the following steps. You MUST:
> 1. [Set up Cloudflare Access](#setting-up-the-admin-ui) to protect the admin UI
> 2. [Pair your device](#device-pairing) via the admin UI at `/_admin/`

You'll also likely want to [enable R2 storage](#persistent-storage-r2) so your paired devices and conversation history persist across container restarts (optional but recommended).

## Setting Up the Admin UI

To use the admin UI at `/_admin/` for device management, you need to:
1. Enable Cloudflare Access on your worker
2. Set the Access secrets so the worker can validate JWTs

### 1. Enable Cloudflare Access on workers.dev

The easiest way to protect your worker is using the built-in Cloudflare Access integration for workers.dev:

1. Go to the [Workers & Pages dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
2. Select your Worker (e.g., `moltbot-sandbox`)
3. In **Settings**, under **Domains & Routes**, in the `workers.dev` row, click the meatballs menu (`...`)
4. Click **Enable Cloudflare Access**
5. Copy the values shown in the dialog (you'll need the AUD tag later). **Note:** The "Manage Cloudflare Access" link in the dialog may 404 - ignore it.
6. To configure who can access, go to **Zero Trust** in the Cloudflare dashboard sidebar → **Access** → **Applications**, and find your worker's application:
   - Add your email address to the allow list
   - Or configure other identity providers (Google, GitHub, etc.)
7. Copy the **Application Audience (AUD)** tag from the Access application settings. This will be your `CF_ACCESS_AUD` in Step 2 below

### 2. Set Access Secrets

After enabling Cloudflare Access, set the secrets so the worker can validate JWTs:

```bash
# Your Cloudflare Access team domain (e.g., "myteam.cloudflareaccess.com")
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN

# The Application Audience (AUD) tag from your Access application that you copied in the step above
npx wrangler secret put CF_ACCESS_AUD
```

If you have **multiple** Access applications pointing at the same Worker (common when you use both `workers.dev` and a custom domain), set `CF_ACCESS_AUD` to a comma-separated list of AUD values, for example:

```bash
# Example format (no spaces required):
# AUD1,AUD2
npx wrangler secret put CF_ACCESS_AUD
```

You can find your team domain in the [Zero Trust Dashboard](https://one.dash.cloudflare.com/) under **Settings** > **Custom Pages** (it's the subdomain before `.cloudflareaccess.com`).

### 3. Redeploy

```bash
npm run deploy
```

Now visit `/_admin/` and you'll be prompted to authenticate via Cloudflare Access before accessing the admin UI.

### Alternative: Manual Access Application

If you prefer more control, you can manually create an Access application:

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Access** > **Applications**
3. Create a new **Self-hosted** application
4. Set the application domain to your Worker URL (e.g., `moltbot-sandbox.your-subdomain.workers.dev`)
5. Add paths to protect: `/_admin/*`, `/api/*`, `/debug/*`
6. Configure your desired identity providers (e.g., email OTP, Google, GitHub)
7. Copy the **Application Audience (AUD)** tag and set the secrets as shown above

### Local Development

For local development, create a `.dev.vars` file with:

```bash
DEV_MODE=true               # Skip Cloudflare Access auth + bypass device pairing
DEBUG_ROUTES=true           # Enable /debug/* routes (optional)
```

## Authentication

By default, moltbot uses **device pairing** for authentication. When a new device (browser, CLI, etc.) connects, it must be approved via the admin UI at `/_admin/`.

### Device Pairing

1. A device connects to the gateway
2. The connection is held pending until approved
3. An admin approves the device via `/_admin/`
4. The device is now paired and can connect freely

This is the most secure option as it requires explicit approval for each device.

### Gateway Token (Required)

A gateway token is required to access the Control UI when hosted remotely. Pass it as a query parameter:

```
https://your-worker.workers.dev/?token=YOUR_TOKEN
wss://your-worker.workers.dev/ws?token=YOUR_TOKEN
```

**Note:** Even with a valid token, new devices still require approval via the admin UI at `/_admin/` (see Device Pairing above).

For local development only, set `DEV_MODE=true` in `.dev.vars` to skip Cloudflare Access authentication and enable `allowInsecureAuth` (bypasses device pairing entirely).

## Persistent Storage (R2)

By default, moltbot data (configs, paired devices, conversation history) is lost when the container restarts. To enable persistent storage across sessions, configure R2:

### 1. Create R2 API Token

1. Go to **R2** > **Overview** in the [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click **Manage R2 API Tokens**
3. Create a new token with **Object Read & Write** permissions
4. Select the `moltbot-data` bucket (created automatically on first deploy)
5. Copy the **Access Key ID** and **Secret Access Key**

### 2. Set Secrets

```bash
# R2 Access Key ID
npx wrangler secret put R2_ACCESS_KEY_ID

# R2 Secret Access Key
npx wrangler secret put R2_SECRET_ACCESS_KEY

# Your Cloudflare Account ID
npx wrangler secret put CF_ACCOUNT_ID
```

To find your Account ID: Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/), click the three dots menu next to your account name, and select "Copy Account ID".

### How It Works

R2 storage uses a backup/restore approach for simplicity:

**On container startup:**
- If R2 is mounted and contains backup data, it's restored to the moltbot config directory
- OpenClaw uses its default paths (no special configuration needed)

**During operation:**
- A cron job runs every 5 minutes to sync the moltbot config to R2
- You can also trigger a manual backup from the admin UI at `/_admin/`

**In the admin UI:**
- When R2 is configured, you'll see "Last backup: [timestamp]"
- Click "Backup Now" to trigger an immediate sync

Without R2 credentials, moltbot still works but uses ephemeral storage (data lost on container restart).

## Container Lifecycle

By default, the sandbox container stays alive indefinitely (`SANDBOX_SLEEP_AFTER=never`). This is recommended because cold starts take 1-2 minutes.

To reduce costs for infrequently used deployments, you can configure the container to sleep after a period of inactivity:

```bash
npx wrangler secret put SANDBOX_SLEEP_AFTER
# Enter: 10m (or 1h, 30m, etc.)
```

When the container sleeps, the next request will trigger a cold start. If you have R2 storage configured, your paired devices and data will persist across restarts.

## Admin UI

![admin ui](./assets/adminui.png)

Access the admin UI at `/_admin/` to:
- **R2 Storage Status** - Shows if R2 is configured, last backup time, and a "Backup Now" button
- **Restart Gateway** - Kill and restart the moltbot gateway process
- **Device Pairing** - View pending requests, approve devices individually or all at once, view paired devices

The admin UI requires Cloudflare Access authentication (or `DEV_MODE=true` for local development).

## Debug Endpoints

Debug endpoints are available at `/debug/*` when enabled (requires `DEBUG_ROUTES=true` and Cloudflare Access):

- `GET /debug/processes` - List all container processes
- `GET /debug/logs?id=<process_id>` - Get logs for a specific process
- `GET /debug/version` - Get container and moltbot version info

## Optional: Chat Channels

### Telegram

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npm run deploy
```

### Discord

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npm run deploy
```

### Slack

```bash
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_APP_TOKEN
npm run deploy
```

### Feishu / Lark

```bash
npx wrangler secret put FEISHU_APP_ID
npx wrangler secret put FEISHU_APP_SECRET

# Optional config:
# npx wrangler secret put FEISHU_DOMAIN            # "lark" (Intl) or "feishu" (CN)
# npx wrangler secret put FEISHU_CONNECTION_MODE  # "websocket" (default) or "webhook"
# npx wrangler secret put FEISHU_DM_POLICY        # "pairing" (default) or "open"
# npx wrangler secret put FEISHU_GROUP_POLICY     # "open" (default) or "disabled"
# npx wrangler secret put FEISHU_REQUIRE_MENTION  # "true" (default) or "false"

npm run deploy
```

## Optional: Browser Automation (CDP)

This worker includes a Chrome DevTools Protocol (CDP) shim that enables browser automation capabilities. This allows OpenClaw to control a headless browser for tasks like web scraping, screenshots, and automated testing.

### Setup

1. Set a shared secret for authentication:

```bash
npx wrangler secret put CDP_SECRET
# Enter a secure random string
```

2. Set your worker's public URL:

```bash
npx wrangler secret put WORKER_URL
# Enter: https://your-worker.workers.dev
```

3. Redeploy:

```bash
npm run deploy
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /cdp/json/version` | Browser version information |
| `GET /cdp/json/list` | List available browser targets |
| `GET /cdp/json/new` | Create a new browser target |
| `WS /cdp/devtools/browser/{id}` | WebSocket connection for CDP commands |

All endpoints require authentication via the `?secret=<CDP_SECRET>` query parameter.

## Built-in Skills

The container includes pre-installed skills in `/root/.openclaw/skills/`:

### cloudflare-browser

Browser automation via the CDP shim. Requires `CDP_SECRET` and `WORKER_URL` to be set (see [Browser Automation](#optional-browser-automation-cdp) above).

**Scripts:**
- `screenshot.js` - Capture a screenshot of a URL
- `video.js` - Create a video from multiple URLs
- `cdp-client.js` - Reusable CDP client library

**Usage:**
```bash
# Screenshot
node /root/.openclaw/skills/cloudflare-browser/scripts/screenshot.js https://example.com output.png

# Video from multiple URLs
node /root/.openclaw/skills/cloudflare-browser/scripts/video.js "https://site1.com,https://site2.com" output.mp4 --scroll
```

See `skills/cloudflare-browser/SKILL.md` for full documentation.

### clayclaw-memory

Durable “memory” via Game Dev Memory (projects + memories). Requires:

- `GDM_API_TOKEN`
- Optional: `GDM_API_URL`, `GDM_PROJECT_ID`

See `skills/clayclaw-memory/SKILL.md` for usage.

### pajamadot-story

Manage PajamaDot Story projects from inside the container via the `story` CLI. Requires:

- `STORY_TOKEN`

See `skills/pajamadot-story/SKILL.md` for usage.

### story-cli

Interact with the PajamaDot Story Platform from inside the container using the `story` CLI. Requires:

- `STORY_TOKEN` (recommended for headless/agent usage)

Examples:

```bash
story project list --json
story story list --json
```

See `skills/story-cli/SKILL.md` for usage.

## Optional: Cloudflare AI Gateway

You can route API requests through [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) for caching, rate limiting, analytics, and cost tracking. OpenClaw has native support for Cloudflare AI Gateway as a first-class provider.

AI Gateway acts as a proxy between OpenClaw and your AI provider (e.g., Anthropic). Requests are sent to `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic` instead of directly to `api.anthropic.com`, giving you Cloudflare's analytics, caching, and rate limiting. You still need a provider API key (e.g., your Anthropic API key) - the gateway forwards it to the upstream provider.

### Setup

1. Create an AI Gateway in the [AI Gateway section](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/create-gateway) of the Cloudflare Dashboard.
2. Set the three required secrets:

```bash
# Your AI provider's API key (e.g., your Anthropic API key).
# This is passed through the gateway to the upstream provider.
npx wrangler secret put CLOUDFLARE_AI_GATEWAY_API_KEY

# Your Cloudflare account ID
npx wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID

# Your AI Gateway ID (from the gateway overview page)
npx wrangler secret put CF_AI_GATEWAY_GATEWAY_ID
```

All three are required. OpenClaw constructs the gateway URL from the account ID and gateway ID, and passes the API key to the upstream provider through the gateway.

3. Redeploy:

```bash
npm run deploy
```

When Cloudflare AI Gateway is configured, it takes precedence over direct `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

### Choosing a Model

By default, AI Gateway uses Anthropic's Claude Sonnet 4.5. To use a different model or provider, set `CF_AI_GATEWAY_MODEL` with the format `provider/model-id`:

```bash
npx wrangler secret put CF_AI_GATEWAY_MODEL
# Enter: workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

This works with any [AI Gateway provider](https://developers.cloudflare.com/ai-gateway/usage/providers/):

| Provider | Example `CF_AI_GATEWAY_MODEL` value | API key is... |
|----------|-------------------------------------|---------------|
| Workers AI | `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Cloudflare API token |
| OpenAI | `openai/gpt-4o` | OpenAI API key |
| Anthropic | `anthropic/claude-sonnet-4-5` | Anthropic API key |
| Groq | `groq/llama-3.3-70b` | Groq API key |

**Note:** `CLOUDFLARE_AI_GATEWAY_API_KEY` must match the provider you're using - it's your provider's API key, forwarded through the gateway. You can only use one provider at a time through the gateway. For multiple providers, use direct keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) alongside the gateway config.

#### Workers AI with Unified Billing

With [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/), you can use Workers AI models without a separate provider API key - Cloudflare bills you directly. Set `CLOUDFLARE_AI_GATEWAY_API_KEY` to your [AI Gateway authentication token](https://developers.cloudflare.com/ai-gateway/configuration/authentication/) (the `cf-aig-authorization` token).

### Legacy AI Gateway Configuration

The previous `AI_GATEWAY_API_KEY` + `AI_GATEWAY_BASE_URL` approach is still supported for backward compatibility but is deprecated in favor of the native configuration above.

## All Secrets Reference

| Secret | Required | Description |
|--------|----------|-------------|
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Yes* | Your AI provider's API key, passed through the gateway (e.g., your Anthropic API key). Requires `CF_AI_GATEWAY_ACCOUNT_ID` and `CF_AI_GATEWAY_GATEWAY_ID` |
| `CF_AI_GATEWAY_ACCOUNT_ID` | Yes* | Your Cloudflare account ID (used to construct the gateway URL) |
| `CF_AI_GATEWAY_GATEWAY_ID` | Yes* | Your AI Gateway ID (used to construct the gateway URL) |
| `CF_AI_GATEWAY_MODEL` | No | Override default model: `provider/model-id` (e.g. `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`). See [Choosing a Model](#choosing-a-model) |
| `ANTHROPIC_API_KEY` | Yes* | Direct Anthropic API key (alternative to AI Gateway) |
| `ANTHROPIC_BASE_URL` | No | Direct Anthropic API base URL |
| `OPENAI_API_KEY` | No | OpenAI API key (alternative provider) |
| `AI_GATEWAY_API_KEY` | No | Legacy AI Gateway API key (deprecated, use `CLOUDFLARE_AI_GATEWAY_API_KEY` instead) |
| `AI_GATEWAY_BASE_URL` | No | Legacy AI Gateway endpoint URL (deprecated) |
| `CF_ACCESS_TEAM_DOMAIN` | Yes* | Cloudflare Access team domain (required for admin UI) |
| `CF_ACCESS_AUD` | Yes* | Cloudflare Access application audience (required for admin UI) |
| `MOLTBOT_GATEWAY_TOKEN` | Yes | Gateway token for authentication (pass via `?token=` query param) |
| `DEV_MODE` | No | Set to `true` to skip CF Access auth + device pairing (local dev only) |
| `E2E_TEST_MODE` | No | Set to `true` to skip CF Access auth but keep device pairing (useful for E2E tests) |
| `DEBUG_ROUTES` | No | Set to `true` to enable `/debug/*` routes |
| `SANDBOX_SLEEP_AFTER` | No | Container sleep timeout: `never` (default) or duration like `10m`, `1h` |
| `R2_ACCESS_KEY_ID` | No | R2 access key for persistent storage |
| `R2_SECRET_ACCESS_KEY` | No | R2 secret key for persistent storage |
| `CF_ACCOUNT_ID` | No | Cloudflare account ID (required for R2 storage) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `TELEGRAM_DM_POLICY` | No | Telegram DM policy: `pairing` (default) or `open` |
| `DISCORD_BOT_TOKEN` | No | Discord bot token |
| `DISCORD_DM_POLICY` | No | Discord DM policy: `pairing` (default) or `open` |
| `SLACK_BOT_TOKEN` | No | Slack bot token |
| `SLACK_APP_TOKEN` | No | Slack app token |
| `FEISHU_APP_ID` | No | Feishu/Lark app ID |
| `FEISHU_APP_SECRET` | No | Feishu/Lark app secret |
| `FEISHU_DOMAIN` | No | Feishu domain: `lark` (Intl), `feishu` (CN), or custom URL |
| `FEISHU_CONNECTION_MODE` | No | Feishu connection mode: `websocket` (default) or `webhook` |
| `FEISHU_DM_POLICY` | No | Feishu DM policy: `pairing` (default) or `open` |
| `FEISHU_GROUP_POLICY` | No | Feishu group policy: `open` (default) or `disabled` |
| `FEISHU_REQUIRE_MENTION` | No | Feishu require mention: `true` (default) or `false` |
| `OPENCLAW_ASSISTANT_NAME` | No | Control UI assistant display name (e.g. `ClayClaw`) |
| `OPENCLAW_ASSISTANT_AVATAR` | No | Control UI assistant avatar initial (single character) |
| `GDM_API_URL` | No | Game Dev Memory API base URL (defaults to `https://api-game-dev-memory.pajamadot.com`) |
| `GDM_API_TOKEN` | No | Game Dev Memory API token (`gdm_...`) |
| `GDM_PROJECT_ID` | No | Default Game Dev Memory project UUID |
| `STORY_TOKEN` | No | PajamaDot Story Platform token (`sp_live_...`) for `story` CLI |
| `CDP_SECRET` | No | Shared secret for CDP endpoint authentication (see [Browser Automation](#optional-browser-automation-cdp)) |
| `WORKER_URL` | No | Public URL of the worker (required for CDP) |

## Security Considerations

### Authentication Layers

OpenClaw in Cloudflare Sandbox uses multiple authentication layers:

1. **Cloudflare Access** - Protects admin routes (`/_admin/`, `/api/*`, `/debug/*`). Only authenticated users can manage devices.

2. **Gateway Token** - Required to access the Control UI. Pass via `?token=` query parameter. Keep this secret.

3. **Device Pairing** - Each device (browser, CLI, chat platform DM) must be explicitly approved via the admin UI before it can interact with the assistant. This is the default "pairing" DM policy.

## Troubleshooting

**`npm run dev` fails with an `Unauthorized` error:** You need to enable Cloudflare Containers in the [Containers dashboard](https://dash.cloudflare.com/?to=/:account/workers/containers)

**Gateway fails to start:** Check `npx wrangler secret list` and `npx wrangler tail`

**Config changes not working:** Edit the `# Build cache bust:` comment in `Dockerfile` and redeploy

**Slow first request:** Cold starts take 1-2 minutes. Subsequent requests are faster.

**R2 not mounting:** Check that all three R2 secrets are set (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`). Note: R2 mounting only works in production, not with `wrangler dev`.

**Access denied on admin routes:** Ensure `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, and that your Cloudflare Access application is configured correctly.

**Devices not appearing in admin UI:** Device list commands take 10-15 seconds due to WebSocket connection overhead. Wait and refresh.

**WebSocket issues in local development:** `wrangler dev` has known limitations with WebSocket proxying through the sandbox. HTTP requests work but WebSocket connections may fail. Deploy to Cloudflare for full functionality.

## Known Issues

### Windows: Gateway fails to start with exit code 126 (permission denied)

On Windows, Git may check out shell scripts with CRLF line endings instead of LF. This causes `start-openclaw.sh` to fail with exit code 126 inside the Linux container. Ensure your repository uses LF line endings - configure Git with `git config --global core.autocrlf input` or add a `.gitattributes` file with `* text=auto eol=lf`. See [#64](https://github.com/cloudflare/moltworker/issues/64) for details.

## Links

- [OpenClaw](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai/)
- [Cloudflare Sandbox Docs](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Access Docs](https://developers.cloudflare.com/cloudflare-one/policies/access/)
