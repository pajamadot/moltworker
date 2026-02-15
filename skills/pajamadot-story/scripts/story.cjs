#!/usr/bin/env node
/**
 * PajamaDot Story skill wrapper.
 *
 * This is intentionally thin: it validates STORY_TOKEN exists and then forwards
 * args to the `story` CLI installed in the container image.
 */

const { spawnSync } = require('node:child_process');
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

      // Strip surrounding quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }

      // Minimal unescaping for the .env format we generate at container boot.
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
  // The container boot script writes secrets to ~/.openclaw/.env so agent-run
  // subprocesses can load them even if they don't inherit the full env.
  const home = os.homedir();
  const candidate = path.join(home, '.openclaw', '.env');
  if (loadEnvFile(candidate)) return;
  // Fallback for containers where homedir resolution differs.
  loadEnvFile('/root/.openclaw/.env');
}

function hasTokenArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--token') return Boolean(args[i + 1]);
    if (a.startsWith('--token=')) return a.slice('--token='.length).trim() !== '';
  }
  return false;
}

function usage() {
  console.error('Usage:');
  console.error('  node story.cjs <story-cli args...>');
  console.error('');
  console.error('Examples:');
  console.error('  node story.cjs project list --json');
  console.error('  node story.cjs story list --json');
  console.error('  node story.cjs use project <project-id>');
  console.error('  node story.cjs use story <story-id>');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  loadOpenClawEnv();

  const hasToken =
    (process.env.STORY_TOKEN && String(process.env.STORY_TOKEN).trim() !== '') ||
    hasTokenArg(args);
  if (!hasToken) {
    // Don't hard-fail: some commands don't require auth (e.g. `story health`),
    // and interactive login flows may be used in some environments.
    console.error('Warning: STORY_TOKEN is not set (expected a token like sp_live_...)');
  }

  const r = spawnSync('story', args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });

  if (typeof r.status === 'number') process.exit(r.status);
  process.exit(1);
}

main();
