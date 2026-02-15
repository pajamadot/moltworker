#!/bin/bash
# Startup script for OpenClaw in Cloudflare Sandbox
# This script:
# 1. Restores config/workspace/skills from R2 via rclone (if configured)
# 2. Runs openclaw onboard --non-interactive to configure from env vars
# 3. Patches config for features onboard doesn't cover (channels, gateway auth)
# 4. Starts a background sync loop (rclone, watches for file changes)
# 5. Starts the gateway

set -e

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
fi

CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
# OpenClaw defaults (see `openclaw skills list --verbose`):
# - workspaceDir: /root/.openclaw/workspace
# - managedSkillsDir: /root/.openclaw/skills
WORKSPACE_DIR="$CONFIG_DIR/workspace"
SKILLS_DIR="$CONFIG_DIR/skills"

# Legacy paths kept for backward compatibility with older images/backups.
LEGACY_WORKSPACE_DIR="/root/clawd"
LEGACY_SKILLS_DIR="/root/clawd/skills"
RCLONE_CONF="/root/.config/rclone/rclone.conf"
LAST_SYNC_FILE="/tmp/.last-sync"

echo "Config directory: $CONFIG_DIR"

mkdir -p "$CONFIG_DIR"

# ============================================================
# RCLONE SETUP
# ============================================================

r2_configured() {
    [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$CF_ACCOUNT_ID" ]
}

R2_BUCKET="${R2_BUCKET_NAME:-moltbot-data}"

setup_rclone() {
    mkdir -p "$(dirname "$RCLONE_CONF")"
    cat > "$RCLONE_CONF" << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = $R2_ACCESS_KEY_ID
secret_access_key = $R2_SECRET_ACCESS_KEY
endpoint = https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
    touch /tmp/.rclone-configured
    echo "Rclone configured for bucket: $R2_BUCKET"
}

RCLONE_FLAGS="--transfers=16 --fast-list --s3-no-check-bucket"

# ============================================================
# RESTORE FROM R2
# ============================================================

if r2_configured; then
    setup_rclone

    echo "Checking R2 for existing backup..."
    # Check if R2 has an openclaw config backup
    if rclone ls "r2:${R2_BUCKET}/openclaw/openclaw.json" $RCLONE_FLAGS 2>/dev/null | grep -q openclaw.json; then
        echo "Restoring config from R2..."
        rclone copy "r2:${R2_BUCKET}/openclaw/" "$CONFIG_DIR/" $RCLONE_FLAGS \
            --exclude 'workspace/**' --exclude 'skills/**' \
            --exclude 'plugins/**' --exclude 'extensions/**' \
            --exclude '**/workspace/**' --exclude '**/skills/**' \
            --exclude '**/plugins/**' --exclude '**/extensions/**' \
            --exclude '.env' --exclude '**/.env' \
            -v 2>&1 || echo "WARNING: config restore failed with exit code $?"
        echo "Config restored"
    elif rclone ls "r2:${R2_BUCKET}/clawdbot/clawdbot.json" $RCLONE_FLAGS 2>/dev/null | grep -q clawdbot.json; then
        echo "Restoring from legacy R2 backup..."
        rclone copy "r2:${R2_BUCKET}/clawdbot/" "$CONFIG_DIR/" $RCLONE_FLAGS \
            --exclude 'workspace/**' --exclude 'skills/**' \
            --exclude 'plugins/**' --exclude 'extensions/**' \
            --exclude '**/workspace/**' --exclude '**/skills/**' \
            --exclude '**/plugins/**' --exclude '**/extensions/**' \
            --exclude '.env' --exclude '**/.env' \
            -v 2>&1 || echo "WARNING: legacy config restore failed with exit code $?"
        if [ -f "$CONFIG_DIR/clawdbot.json" ] && [ ! -f "$CONFIG_FILE" ]; then
            mv "$CONFIG_DIR/clawdbot.json" "$CONFIG_FILE"
        fi
        echo "Legacy config restored and migrated"
    else
        echo "No backup found in R2, starting fresh"
    fi

    # Restore workspace
    REMOTE_WS_COUNT=$(rclone ls "r2:${R2_BUCKET}/workspace/" $RCLONE_FLAGS 2>/dev/null | wc -l)
    if [ "$REMOTE_WS_COUNT" -gt 0 ]; then
        echo "Restoring workspace from R2 ($REMOTE_WS_COUNT files)..."
        mkdir -p "$WORKSPACE_DIR"
        rclone copy "r2:${R2_BUCKET}/workspace/" "$WORKSPACE_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: workspace restore failed with exit code $?"
        echo "Workspace restored"
    fi

    # Restore skills
    REMOTE_SK_COUNT=$(rclone ls "r2:${R2_BUCKET}/skills/" $RCLONE_FLAGS 2>/dev/null | wc -l)
    if [ "$REMOTE_SK_COUNT" -gt 0 ]; then
        echo "Restoring skills from R2 ($REMOTE_SK_COUNT files)..."
        mkdir -p "$SKILLS_DIR"
        rclone copy "r2:${R2_BUCKET}/skills/" "$SKILLS_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: skills restore failed with exit code $?"
        echo "Skills restored"
    fi
else
    echo "R2 not configured, starting fresh"
fi

# Legacy migration: older versions stored workspace/skills under /root/clawd.
if [ -d "$LEGACY_WORKSPACE_DIR" ] && [ ! -d "$WORKSPACE_DIR" ]; then
    mkdir -p "$WORKSPACE_DIR"
fi
if [ -d "$LEGACY_WORKSPACE_DIR" ] && [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ] && [ -n "$(ls -A "$LEGACY_WORKSPACE_DIR" 2>/dev/null)" ]; then
    echo "Migrating legacy workspace from $LEGACY_WORKSPACE_DIR -> $WORKSPACE_DIR"
    cp -a "$LEGACY_WORKSPACE_DIR/." "$WORKSPACE_DIR/" 2>/dev/null || true
fi

if [ -d "$LEGACY_SKILLS_DIR" ] && [ ! -d "$SKILLS_DIR" ]; then
    mkdir -p "$SKILLS_DIR"
fi
if [ -d "$LEGACY_SKILLS_DIR" ] && [ -z "$(ls -A "$SKILLS_DIR" 2>/dev/null)" ] && [ -n "$(ls -A "$LEGACY_SKILLS_DIR" 2>/dev/null)" ]; then
    echo "Migrating legacy skills from $LEGACY_SKILLS_DIR -> $SKILLS_DIR"
    cp -a "$LEGACY_SKILLS_DIR/." "$SKILLS_DIR/" 2>/dev/null || true
fi

# ============================================================
# RUNTIME .env (keeps secrets available to OpenClaw agent runs)
# ============================================================
# Some OpenClaw components prefer reading keys from ~/.openclaw/.env (daemon-style),
# and some tool sandboxes may not inherit the full parent environment. We write a
# runtime .env from the container env vars on every boot, AFTER any R2 restore.
#
# IMPORTANT: We intentionally do NOT sync this file to R2 (see sync excludes below).
ENV_FILE="$CONFIG_DIR/.env"
echo "Writing runtime env file: $ENV_FILE"
umask 077
: > "$ENV_FILE"

append_env() {
    local name="$1"
    local val="${!name}"
    if [ -z "$val" ]; then
        return 0
    fi
    # .env format: NAME="value" with basic escaping
    val="${val//\\/\\\\}"
    val="${val//\"/\\\"}"
    val="${val//$'\n'/\\n}"
    printf '%s="%s"\n' "$name" "$val" >> "$ENV_FILE"
}

# AI providers
append_env "ANTHROPIC_API_KEY"
append_env "ANTHROPIC_BASE_URL"
append_env "OPENAI_API_KEY"
append_env "CLOUDFLARE_AI_GATEWAY_API_KEY"
append_env "CF_AI_GATEWAY_ACCOUNT_ID"
append_env "CF_AI_GATEWAY_GATEWAY_ID"
append_env "CF_AI_GATEWAY_MODEL"
append_env "OPENCLAW_DEFAULT_MODEL"
append_env "OPENCLAW_GATEWAY_TOKEN"
append_env "WORKER_URL"
append_env "CF_ACCOUNT_ID"

# Optional skill integrations
append_env "GDM_API_URL"
append_env "GDM_API_TOKEN"
append_env "GDM_PROJECT_ID"
append_env "STORY_TOKEN"
append_env "STORY_API_URL"
append_env "STORY_ASSET_URL"
append_env "STORY_GENERATION_URL"
append_env "STORY_AUTH_URL"
append_env "STORY_CDN_URL"
append_env "STORY_OAUTH_CALLBACK_TIMEOUT_SECS"

chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "Installed skills in $SKILLS_DIR:"
ls -1 "$SKILLS_DIR" 2>/dev/null || true

# ============================================================
# ONBOARD (only if no config exists yet)
# ============================================================
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, running openclaw onboard..."

    AUTH_ARGS=""
    if [ -n "$CLOUDFLARE_AI_GATEWAY_API_KEY" ] && [ -n "$CF_AI_GATEWAY_ACCOUNT_ID" ] && [ -n "$CF_AI_GATEWAY_GATEWAY_ID" ]; then
        AUTH_ARGS="--auth-choice cloudflare-ai-gateway-api-key \
            --cloudflare-ai-gateway-account-id $CF_AI_GATEWAY_ACCOUNT_ID \
            --cloudflare-ai-gateway-gateway-id $CF_AI_GATEWAY_GATEWAY_ID \
            --cloudflare-ai-gateway-api-key $CLOUDFLARE_AI_GATEWAY_API_KEY"
    elif [ -n "$ANTHROPIC_API_KEY" ]; then
        AUTH_ARGS="--auth-choice apiKey --anthropic-api-key $ANTHROPIC_API_KEY"
    elif [ -n "$OPENAI_API_KEY" ]; then
        AUTH_ARGS="--auth-choice openai-api-key --openai-api-key $OPENAI_API_KEY"
    fi

    openclaw onboard --non-interactive --accept-risk \
        --mode local \
        $AUTH_ARGS \
        --gateway-port 18789 \
        --gateway-bind lan \
        --skip-channels \
        --skip-skills \
        --skip-health

    echo "Onboard completed"
else
    echo "Using existing config"
fi

# ============================================================
# PATCH CONFIG (channels, gateway auth, trusted proxies)
# ============================================================
# openclaw onboard handles provider/model config, but we need to patch in:
# - Channel config (Telegram, Discord, Slack)
# - Gateway token auth
# - Trusted proxies for sandbox networking
# - Base URL override for legacy AI Gateway path
node << 'EOFPATCH'
const fs = require('fs');

const configPath = '/root/.openclaw/openclaw.json';
console.log('Patching config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

config.gateway = config.gateway || {};
config.channels = config.channels || {};
config.ui = config.ui || {};

// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
// Cloudflare Sandbox/Workers proxy network uses private RFC1918 space (commonly 10.1.x.x).
// Use a CIDR range so OpenClaw trusts X-Forwarded-* headers and device pairing doesn't
// appear to "change" on every reconnect.
config.gateway.trustedProxies = ['10.0.0.0/8'];

// Branding (Control UI)
config.ui.assistant = config.ui.assistant || {};
config.ui.assistant.name = process.env.OPENCLAW_ASSISTANT_NAME || 'ClayClaw';
config.ui.assistant.avatar = process.env.OPENCLAW_ASSISTANT_AVATAR || 'C';

// Ensure our packaged skills are enabled by default (do not override explicit disables).
config.skills = config.skills || {};
config.skills.entries = config.skills.entries || {};
for (const name of ['cloudflare-browser', 'clayclaw-memory', 'pajamadot-story', 'story-cli', 'model-switch']) {
    config.skills.entries[name] = config.skills.entries[name] || {};
    if (typeof config.skills.entries[name].enabled !== 'boolean') {
        config.skills.entries[name].enabled = true;
    }
}

if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
}

if (process.env.OPENCLAW_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Legacy AI Gateway base URL override:
// ANTHROPIC_BASE_URL is picked up natively by the Anthropic SDK,
// so we don't need to patch the provider config. Writing a provider
// entry without a models array breaks OpenClaw's config validation.

// AI Gateway model override (CF_AI_GATEWAY_MODEL=provider/model-id)
// Adds a provider entry for any AI Gateway provider and sets it as default model.
// Examples:
//   workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
//   openai/gpt-4o
//   anthropic/claude-sonnet-4-5
if (process.env.CF_AI_GATEWAY_MODEL) {
    const raw = process.env.CF_AI_GATEWAY_MODEL;
    const slashIdx = raw.indexOf('/');
    const gwProvider = raw.substring(0, slashIdx);
    const modelId = raw.substring(slashIdx + 1);

    const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
    const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
    const apiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;

    let baseUrl;
    if (accountId && gatewayId) {
        baseUrl = 'https://gateway.ai.cloudflare.com/v1/' + accountId + '/' + gatewayId + '/' + gwProvider;
        if (gwProvider === 'workers-ai') baseUrl += '/v1';
    } else if (gwProvider === 'workers-ai' && process.env.CF_ACCOUNT_ID) {
        baseUrl = 'https://api.cloudflare.com/client/v4/accounts/' + process.env.CF_ACCOUNT_ID + '/ai/v1';
    }

    if (baseUrl && apiKey) {
        const api = gwProvider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
        const providerName = 'cf-ai-gw-' + gwProvider;

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        config.models.providers[providerName] = {
            baseUrl: baseUrl,
            apiKey: apiKey,
            api: api,
            models: [{ id: modelId, name: modelId, contextWindow: 131072, maxTokens: 8192 }],
        };
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: providerName + '/' + modelId };
        console.log('AI Gateway model override: provider=' + providerName + ' model=' + modelId + ' via ' + baseUrl);
    } else {
        console.warn('CF_AI_GATEWAY_MODEL set but missing required config (account ID, gateway ID, or API key)');
    }
}

// Default model override (OPENCLAW_DEFAULT_MODEL=provider/model-id)
// For direct providers (no Cloudflare AI Gateway). This only applies when
// CF_AI_GATEWAY_MODEL is NOT set, since that override also creates provider config.
// Example:
//   anthropic/claude-3-5-haiku-latest
if (process.env.OPENCLAW_DEFAULT_MODEL) {
    if (process.env.CF_AI_GATEWAY_MODEL) {
        console.log('OPENCLAW_DEFAULT_MODEL is set but CF_AI_GATEWAY_MODEL is also set; ignoring OPENCLAW_DEFAULT_MODEL');
    } else {
        const raw = process.env.OPENCLAW_DEFAULT_MODEL;
        const slashIdx = raw.indexOf('/');
        const providerName = raw.substring(0, slashIdx);
        const modelId = raw.substring(slashIdx + 1);

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        const provider = config.models.providers[providerName];
        if (!provider) {
            console.warn('OPENCLAW_DEFAULT_MODEL set but provider not found in config.models.providers: ' + providerName);
        } else {
            provider.models = Array.isArray(provider.models) ? provider.models : [];
            const existing = provider.models.find((m) => m && (m.id === modelId || m.name === modelId));
            if (!existing) {
                provider.models.push({ id: modelId, name: modelId, contextWindow: 131072, maxTokens: 8192 });
            }
            config.agents = config.agents || {};
            config.agents.defaults = config.agents.defaults || {};
            config.agents.defaults.model = { primary: providerName + '/' + modelId };
            console.log('Default model override: provider=' + providerName + ' model=' + modelId);
        }
    }
}

// Telegram configuration
// Overwrite entire channel object to drop stale keys from old R2 backups
// that would fail OpenClaw's strict config validation (see #47)
if (process.env.TELEGRAM_BOT_TOKEN) {
    const dmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
    config.channels.telegram = {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        enabled: true,
        dmPolicy: dmPolicy,
    };
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
        config.channels.telegram.allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(',');
    } else if (dmPolicy === 'open') {
        config.channels.telegram.allowFrom = ['*'];
    }
}

// Discord configuration
// Discord uses a nested dm object: dm.policy, dm.allowFrom (per DiscordDmConfig)
if (process.env.DISCORD_BOT_TOKEN) {
    const dmPolicy = process.env.DISCORD_DM_POLICY || 'pairing';
    // Merge rather than overwriting so edits made via the Control UI (e.g. guild allowlists)
    // survive restarts and R2 restore.
    config.channels.discord = config.channels.discord || {};
    config.channels.discord.token = process.env.DISCORD_BOT_TOKEN;
    config.channels.discord.enabled = true;

    // Guild messages: OpenClaw's secure baseline is allowlist, but for this worker we default
    // to "open" so `@bot` works out-of-the-box in guild channels (still mention-gated by default).
    // Users can tighten this by setting groupPolicy="allowlist" + configuring guilds/channels.
    if (!config.channels.discord.groupPolicy) {
        config.channels.discord.groupPolicy = 'open';
    }

    config.channels.discord.dm = config.channels.discord.dm || {};
    config.channels.discord.dm.policy = dmPolicy;
    if (dmPolicy === 'open') {
        config.channels.discord.dm.allowFrom = ['*'];
    } else if (config.channels.discord.dm.allowFrom) {
        delete config.channels.discord.dm.allowFrom;
    }
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = {
        botToken: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        enabled: true,
    };
}

// Feishu/Lark configuration (OpenClaw extension)
// Merge rather than overwriting so allowlists and other settings survive restarts.
if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    config.channels.feishu = config.channels.feishu || {};
    config.channels.feishu.enabled = true;
    config.channels.feishu.appId = process.env.FEISHU_APP_ID;
    config.channels.feishu.appSecret = process.env.FEISHU_APP_SECRET;

    if (process.env.FEISHU_DOMAIN) {
        config.channels.feishu.domain = process.env.FEISHU_DOMAIN;
    }
    if (process.env.FEISHU_CONNECTION_MODE) {
        config.channels.feishu.connectionMode = process.env.FEISHU_CONNECTION_MODE;
    } else if (!config.channels.feishu.connectionMode) {
        config.channels.feishu.connectionMode = 'websocket';
    }

    if (process.env.FEISHU_DM_POLICY) {
        config.channels.feishu.dmPolicy = process.env.FEISHU_DM_POLICY;
    } else if (!config.channels.feishu.dmPolicy) {
        config.channels.feishu.dmPolicy = 'pairing';
    }

    if (process.env.FEISHU_GROUP_POLICY) {
        config.channels.feishu.groupPolicy = process.env.FEISHU_GROUP_POLICY;
    } else if (!config.channels.feishu.groupPolicy) {
        config.channels.feishu.groupPolicy = 'open';
    }

    if (process.env.FEISHU_REQUIRE_MENTION) {
        config.channels.feishu.requireMention = process.env.FEISHU_REQUIRE_MENTION.toLowerCase() === 'true';
    } else if (typeof config.channels.feishu.requireMention !== 'boolean') {
        config.channels.feishu.requireMention = true;
    }
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration patched successfully');
EOFPATCH

# Best-effort migrations/repairs for config drift across OpenClaw versions.
# This is especially important when restoring a config from R2 built on an older version.
#
# NOTE: In Cloudflare Sandbox, we've seen `openclaw doctor --fix` hang occasionally, which blocks
# the gateway from ever binding to the port. Keep this best-effort and time-bounded.
echo "Running OpenClaw doctor (non-interactive)..."
# Pre-fix the common permission warnings (avoid noisy logs and potential doctor stalls).
chmod 700 "$CONFIG_DIR" 2>/dev/null || true
chmod 600 "$CONFIG_FILE" 2>/dev/null || true

if command -v timeout >/dev/null 2>&1; then
    timeout 120s openclaw doctor --fix --non-interactive --yes || echo "WARNING: OpenClaw doctor failed or timed out (continuing)"
else
    openclaw doctor --fix --non-interactive --yes || echo "WARNING: OpenClaw doctor failed (continuing)"
fi

# ============================================================
# BACKGROUND SYNC LOOP
# ============================================================
if r2_configured; then
    echo "Starting background R2 sync loop..."
    (
        MARKER=/tmp/.last-sync-marker
        LOGFILE=/tmp/r2-sync.log
        touch "$MARKER"

        while true; do
            sleep 30

            CHANGED=/tmp/.changed-files
            {
                # Ignore workspace/skills here; those are synced separately.
                find "$CONFIG_DIR" -newer "$MARKER" -type f -printf '%P\n' 2>/dev/null | grep -v '^workspace/' | grep -v '^skills/' | grep -v '^plugins/' | grep -v '^extensions/' | grep -v '^\\.env$' || true
                find "$WORKSPACE_DIR" -newer "$MARKER" \
                    -not -path '*/node_modules/*' \
                    -not -path '*/.git/*' \
                    -type f -printf '%P\n' 2>/dev/null
                find "$SKILLS_DIR" -newer "$MARKER" \
                    -not -path '*/node_modules/*' \
                    -not -path '*/.git/*' \
                    -type f -printf '%P\n' 2>/dev/null
            } > "$CHANGED"

            COUNT=$(wc -l < "$CHANGED" 2>/dev/null || echo 0)

            if [ "$COUNT" -gt 0 ]; then
                echo "[sync] Uploading changes ($COUNT files) at $(date)" >> "$LOGFILE"
                rclone sync "$CONFIG_DIR/" "r2:${R2_BUCKET}/openclaw/" \
                    $RCLONE_FLAGS --exclude='workspace/**' --exclude='skills/**' --exclude='plugins/**' --exclude='extensions/**' --exclude='**/plugins/**' --exclude='**/extensions/**' --exclude='.env' --exclude='**/.env' --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='.git/**' 2>> "$LOGFILE"
                if [ -d "$WORKSPACE_DIR" ]; then
                    rclone sync "$WORKSPACE_DIR/" "r2:${R2_BUCKET}/workspace/" \
                        $RCLONE_FLAGS --exclude='.git/**' --exclude='node_modules/**' 2>> "$LOGFILE"
                fi
                if [ -d "$SKILLS_DIR" ]; then
                    rclone sync "$SKILLS_DIR/" "r2:${R2_BUCKET}/skills/" \
                        $RCLONE_FLAGS 2>> "$LOGFILE"
                fi
                date -Iseconds > "$LAST_SYNC_FILE"
                touch "$MARKER"
                echo "[sync] Complete at $(date)" >> "$LOGFILE"
            fi
        done
    ) &
    echo "Background sync loop started (PID: $!)"
fi

# ============================================================
# START GATEWAY
# ============================================================
echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"

rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

echo "Dev mode: ${OPENCLAW_DEV_MODE:-false}"

if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan --token "$OPENCLAW_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan
fi
