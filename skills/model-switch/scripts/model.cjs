#!/usr/bin/env node
/**
 * OpenClaw default model switcher.
 *
 * Edits /root/.openclaw/openclaw.json to:
 * - update config.agents.defaults.model.primary
 * - ensure the chosen provider contains the chosen model in its models list
 *
 * Supports:
 * - Direct providers: "anthropic/<model>", "openai/<model>", etc (provider must exist in config)
 * - Cloudflare AI Gateway: "<provider>/<model>" with --ai-gateway (creates cf-ai-gw-<provider>)
 *
 * Optional: restart gateway via POST ${WORKER_URL}/api/restart?token=...
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadEnvFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const eq = line.indexOf('=');
      if (eq <= 0) continue;

      let key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (!key) continue;

      if (key.startsWith('export ')) key = key.slice('export '.length).trim();
      if (!key) continue;

      // Don't override explicit env vars passed to the process.
      if (process.env[key] !== undefined) continue;

      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      val = val
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

      process.env[key] = val;
    }
    return true;
  } catch {
    return false;
  }
}

function loadOpenClawEnv() {
  const home = os.homedir();
  const candidate = path.join(home, '.openclaw', '.env');
  if (loadEnvFile(candidate)) return;
  loadEnvFile('/root/.openclaw/.env');
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }

  return { positional, flags };
}

function getFlag(flags, ...names) {
  for (const n of names) {
    if (flags[n] !== undefined) return flags[n];
  }
  return undefined;
}

function parseBool(v, defaultValue) {
  if (v === undefined) return defaultValue;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return defaultValue;
}

function parseNumber(v, defaultValue) {
  if (v === undefined) return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function usage() {
  console.error('Usage:');
  console.error('  node model.cjs get');
  console.error('  node model.cjs list');
  console.error('  node model.cjs set <provider/model-id> [--ai-gateway] [--no-restart]');
  console.error('');
  console.error('Examples:');
  console.error('  node model.cjs set anthropic/claude-3-5-haiku-latest');
  console.error('  node model.cjs set anthropic/claude-3-5-haiku-latest --ai-gateway');
}

function resolveConfigPath(flags) {
  const fromFlag = getFlag(flags, 'config', 'config-path', 'config_path');
  if (fromFlag) return String(fromFlag);
  if (process.env.OPENCLAW_CONFIG_PATH) return process.env.OPENCLAW_CONFIG_PATH;

  const candidates = [
    '/root/.openclaw/openclaw.json',
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return candidates[0];
}

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getDefaultModel(config) {
  return config?.agents?.defaults?.model?.primary || null;
}

function setDefaultModel(config, primary) {
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  const modelObj =
    config.agents.defaults.model && typeof config.agents.defaults.model === 'object'
      ? config.agents.defaults.model
      : {};
  modelObj.primary = primary;
  config.agents.defaults.model = modelObj;
}

function upsertModel(models, modelId, { contextWindow, maxTokens }) {
  if (!Array.isArray(models)) throw new Error('Provider models list is not an array');

  const existing = models.find((m) => m && (m.id === modelId || m.name === modelId));
  if (existing) {
    if (!existing.id) existing.id = modelId;
    if (!existing.name) existing.name = modelId;
    if (!existing.contextWindow) existing.contextWindow = contextWindow;
    if (!existing.maxTokens) existing.maxTokens = maxTokens;
    return;
  }

  models.push({ id: modelId, name: modelId, contextWindow, maxTokens });
}

function parseModelSpec(raw) {
  const slashIdx = raw.indexOf('/');
  if (slashIdx <= 0) return null;
  const provider = raw.slice(0, slashIdx).trim();
  const modelId = raw.slice(slashIdx + 1).trim();
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

function ensureProvider(config, providerName) {
  config.models = config.models || {};
  config.models.providers = config.models.providers || {};
  return config.models.providers[providerName] || null;
}

function setDirectModel(config, modelSpec, opts) {
  const parsed = parseModelSpec(modelSpec);
  if (!parsed) throw new Error('Model must be in the form provider/model-id');

  const provider = ensureProvider(config, parsed.provider);
  if (!provider) {
    throw new Error(
      `Provider "${parsed.provider}" not found in config.models.providers (run openclaw onboard first, or use --ai-gateway).`,
    );
  }

  provider.models = Array.isArray(provider.models) ? provider.models : [];
  upsertModel(provider.models, parsed.modelId, opts);

  config.models.providers[parsed.provider] = provider;
  setDefaultModel(config, `${parsed.provider}/${parsed.modelId}`);
}

function buildAiGatewayBaseUrl(gwProvider) {
  const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
  const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
  if (accountId && gatewayId) {
    let baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/${gwProvider}`;
    if (gwProvider === 'workers-ai') baseUrl += '/v1';
    return baseUrl;
  }

  // Workers AI fallback (no gateway ID): use direct Workers AI endpoint if account ID is known.
  if (gwProvider === 'workers-ai' && process.env.CF_ACCOUNT_ID) {
    return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/v1`;
  }

  return null;
}

function setAiGatewayModel(config, modelSpec, opts) {
  const parsed = parseModelSpec(modelSpec);
  if (!parsed) throw new Error('AI Gateway model must be in the form provider/model-id');

  const apiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error('CLOUDFLARE_AI_GATEWAY_API_KEY is not set (required for AI Gateway provider requests).');
  }

  const baseUrl = buildAiGatewayBaseUrl(parsed.provider);
  if (!baseUrl) {
    throw new Error(
      'Missing AI Gateway config. Set CF_AI_GATEWAY_ACCOUNT_ID + CF_AI_GATEWAY_GATEWAY_ID (or CF_ACCOUNT_ID for workers-ai).',
    );
  }

  const api = parsed.provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  const providerName = `cf-ai-gw-${parsed.provider}`;

  config.models = config.models || {};
  config.models.providers = config.models.providers || {};

  const provider = config.models.providers[providerName] || {};
  provider.baseUrl = baseUrl;
  provider.apiKey = apiKey;
  provider.api = api;
  provider.models = Array.isArray(provider.models) ? provider.models : [];
  upsertModel(provider.models, parsed.modelId, opts);

  config.models.providers[providerName] = provider;
  setDefaultModel(config, `${providerName}/${parsed.modelId}`);
}

async function restartGateway(flags) {
  const wantRestart = !parseBool(getFlag(flags, 'no-restart', 'no_restart'), false);
  if (!wantRestart) return { attempted: false };

  const workerUrl =
    (getFlag(flags, 'worker-url', 'worker_url') || process.env.WORKER_URL || '').trim();
  const token =
    (getFlag(flags, 'token') ||
      process.env.OPENCLAW_GATEWAY_TOKEN ||
      process.env.MOLTBOT_GATEWAY_TOKEN ||
      '').trim();

  if (!workerUrl || !token) {
    return {
      attempted: false,
      ok: false,
      error: 'Missing WORKER_URL or OPENCLAW_GATEWAY_TOKEN for auto-restart',
      hint: 'Restart via /_admin/ (Gateway Restart) or POST /api/admin/gateway/restart (Cloudflare Access required).',
    };
  }

  const base = workerUrl.replace(/\/+$/, '');
  const url = `${base}/api/restart?token=${encodeURIComponent(token)}`;
  const timeoutMs = parseNumber(process.env.MODEL_SWITCH_RESTART_TIMEOUT_MS, 20000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method: 'POST', signal: controller.signal });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      return { attempted: true, ok: false, status: res.status, response: json };
    }

    return { attempted: true, ok: true, status: res.status, response: json };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? `Restart timed out after ${timeoutMs}ms` : String(err);
    return { attempted: true, ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [cmd, arg] = positional;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(cmd ? 0 : 1);
  }

  loadOpenClawEnv();

  const configPath = resolveConfigPath(flags);

  if (cmd === 'get') {
    const config = readJson(configPath);
    console.log(JSON.stringify({ ok: true, configPath, defaultModel: getDefaultModel(config) }, null, 2));
    return;
  }

  if (cmd === 'list') {
    const config = readJson(configPath);
    const providers = config?.models?.providers || {};
    const out = {};
    for (const [name, p] of Object.entries(providers)) {
      const models = Array.isArray(p?.models) ? p.models.map((m) => m?.id || m?.name).filter(Boolean) : [];
      out[name] = {
        api: p?.api,
        baseUrl: p?.baseUrl,
        models,
      };
    }
    console.log(JSON.stringify({ ok: true, configPath, defaultModel: getDefaultModel(config), providers: out }, null, 2));
    return;
  }

  if (cmd === 'set') {
    if (!arg) {
      console.error('Error: missing model spec (expected provider/model-id)');
      usage();
      process.exit(1);
    }

    const config = readJson(configPath);
    const previousDefaultModel = getDefaultModel(config);

    const contextWindow = parseNumber(getFlag(flags, 'context-window', 'context_window'), 131072);
    const maxTokens = parseNumber(getFlag(flags, 'max-tokens', 'max_tokens'), 8192);
    const opts = { contextWindow, maxTokens };

    const viaGateway = parseBool(getFlag(flags, 'ai-gateway', 'aigw', 'gateway', 'via-gateway', 'via_gateway'), false);
    if (viaGateway) {
      setAiGatewayModel(config, String(arg), opts);
    } else {
      setDirectModel(config, String(arg), opts);
    }

    const newDefaultModel = getDefaultModel(config);
    writeJson(configPath, config);

    const restart = await restartGateway(flags);

    console.log(
      JSON.stringify(
        {
          ok: true,
          configPath,
          previousDefaultModel,
          newDefaultModel,
          restart,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(`Error: unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err && err.message ? err.message : String(err));
  process.exit(1);
});

