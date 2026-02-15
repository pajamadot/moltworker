#!/usr/bin/env node
/**
 * ClayClaw Memory - Game Dev Memory API helper
 *
 * Requires:
 * - GDM_API_TOKEN: Bearer token (gdm_...)
 *
 * Optional:
 * - GDM_API_URL: defaults to https://api-game-dev-memory.pajamadot.com
 * - GDM_PROJECT_ID: default project for memory ops
 *
 * Usage:
 *   node gdm.js projects list
 *   node gdm.js projects create --name "UE5 Prototype" --engine unreal --description "..."
 *   node gdm.js projects ensure --name "UE5 Prototype" --engine unreal --description "..."
 *
 *   node gdm.js memories create --project-id <uuid> --category bug --title "..." --content "..." --tags "a,b"
 *   node gdm.js memories search-index --project-id <uuid> --q "build failure" --provider memories_fts --memory-mode balanced --limit 10
 *   node gdm.js memories batch-get --ids "<uuid1>,<uuid2>" --include-content true
 *   node gdm.js memories timeline --project-id <uuid> --limit 100
 */

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

function getEnv(name) {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : null;
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

function splitCsv(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function gdmRequest({ baseUrl, token, method, path, query, body }) {
  const url = new URL(baseUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  const timeoutMsRaw = process.env.GDM_HTTP_TIMEOUT_MS;
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 20000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      `HTTP ${res.status} ${res.statusText} calling ${method} ${path}`;
    const err = new Error(String(msg));
    err.statusCode = res.status; // best-effort for debugging
    err.details = data;
    throw err;
  }

  return data;
}

function usage() {
  console.error('Usage:');
  console.error('  node gdm.js projects list');
  console.error('  node gdm.js projects create --name "..." --engine unreal --description "..."');
  console.error('  node gdm.js projects ensure --name "..." --engine unreal --description "..."');
  console.error('');
  console.error(
    '  node gdm.js memories create --project-id <uuid> --category bug --title "..." --content "..." --tags "a,b"',
  );
  console.error('  node gdm.js memories search-index --project-id <uuid> --q "..." --limit 10');
  console.error('  node gdm.js memories batch-get --ids "<uuid1>,<uuid2>" --include-content true');
  console.error('  node gdm.js memories timeline --project-id <uuid> --limit 100');
}

async function main() {
  const token = getEnv('GDM_API_TOKEN');
  if (!token) {
    console.error('Error: GDM_API_TOKEN is not set (expected an API key like gdm_...)');
    process.exit(1);
  }

  const baseUrl = normalizeBaseUrl(getEnv('GDM_API_URL') || 'https://api-game-dev-memory.pajamadot.com');

  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [resource, action] = positional;

  if (!resource || !action || resource === 'help' || action === 'help') {
    usage();
    process.exit(resource === 'help' || action === 'help' ? 0 : 1);
  }

  // Projects
  if (resource === 'projects' && action === 'list') {
    const data = await gdmRequest({
      baseUrl,
      token,
      method: 'GET',
      path: '/api/projects',
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (resource === 'projects' && (action === 'create' || action === 'ensure')) {
    const name = getFlag(flags, 'name');
    const engine = getFlag(flags, 'engine');
    const description = getFlag(flags, 'description') || '';

    if (!name || !engine) {
      console.error('Error: --name and --engine are required');
      process.exit(1);
    }

    if (action === 'ensure') {
      const existing = await gdmRequest({
        baseUrl,
        token,
        method: 'GET',
        path: '/api/projects',
      });
      const found = Array.isArray(existing)
        ? existing.find((p) => p && p.name === name)
        : existing?.projects?.find?.((p) => p && p.name === name);
      if (found) {
        console.log(JSON.stringify({ ok: true, project: found, created: false }, null, 2));
        return;
      }
    }

    const created = await gdmRequest({
      baseUrl,
      token,
      method: 'POST',
      path: '/api/projects',
      body: { name, engine, description },
    });
    console.log(JSON.stringify({ ok: true, project: created, created: true }, null, 2));
    return;
  }

  // Memories
  if (resource === 'memories' && action === 'create') {
    const projectId =
      getFlag(flags, 'project-id', 'project_id') || getEnv('GDM_PROJECT_ID');
    const category = getFlag(flags, 'category') || 'note';
    const title = getFlag(flags, 'title');
    const content = getFlag(flags, 'content');
    const tags = splitCsv(getFlag(flags, 'tags'));
    const confidence = parseNumber(getFlag(flags, 'confidence'), undefined);

    if (!projectId) {
      console.error('Error: --project-id is required (or set GDM_PROJECT_ID)');
      process.exit(1);
    }
    if (!title || !content) {
      console.error('Error: --title and --content are required');
      process.exit(1);
    }

    const body = {
      project_id: projectId,
      session_id: null,
      category,
      source_type: 'manual',
      title,
      content,
      tags,
      context: {},
      ...(confidence !== undefined ? { confidence } : {}),
    };

    const created = await gdmRequest({
      baseUrl,
      token,
      method: 'POST',
      path: '/api/memories',
      body,
    });
    console.log(JSON.stringify(created, null, 2));
    return;
  }

  if (resource === 'memories' && action === 'search-index') {
    const projectId =
      getFlag(flags, 'project-id', 'project_id') || getEnv('GDM_PROJECT_ID');
    const q = getFlag(flags, 'q', 'query');
    const provider = getFlag(flags, 'provider') || 'memories_fts';
    const memoryMode = getFlag(flags, 'memory-mode', 'memory_mode') || 'balanced';
    const limit = parseNumber(getFlag(flags, 'limit'), 20);

    if (!projectId) {
      console.error('Error: --project-id is required (or set GDM_PROJECT_ID)');
      process.exit(1);
    }
    if (!q) {
      console.error('Error: --q is required');
      process.exit(1);
    }

    const data = await gdmRequest({
      baseUrl,
      token,
      method: 'GET',
      path: '/api/memories/search-index',
      query: {
        project_id: projectId,
        q,
        provider,
        memory_mode: memoryMode,
        limit,
      },
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (resource === 'memories' && action === 'batch-get') {
    const ids = splitCsv(getFlag(flags, 'ids'));
    const includeContent = parseBool(getFlag(flags, 'include-content', 'include_content'), true);

    if (!ids.length) {
      console.error('Error: --ids is required (comma-separated memory IDs)');
      process.exit(1);
    }

    const data = await gdmRequest({
      baseUrl,
      token,
      method: 'POST',
      path: '/api/memories/batch-get',
      body: { ids, include_content: includeContent },
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (resource === 'memories' && action === 'timeline') {
    const projectId =
      getFlag(flags, 'project-id', 'project_id') || getEnv('GDM_PROJECT_ID');
    const limit = parseNumber(getFlag(flags, 'limit'), 100);

    if (!projectId) {
      console.error('Error: --project-id is required (or set GDM_PROJECT_ID)');
      process.exit(1);
    }

    const data = await gdmRequest({
      baseUrl,
      token,
      method: 'GET',
      path: '/api/memories/timeline',
      query: { project_id: projectId, limit },
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.error(`Error: unknown command: ${resource} ${action}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err && err.message ? err.message : String(err));
  if (err && err.details) {
    // Avoid dumping tokens; just show structured error details if present.
    console.error('Details:', JSON.stringify(err.details, null, 2));
  }
  process.exit(1);
});
