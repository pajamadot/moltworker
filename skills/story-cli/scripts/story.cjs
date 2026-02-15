#!/usr/bin/env node
/**
 * Story CLI wrapper for agents.
 *
 * - Loads STORY_* env vars from ~/.openclaw/.env if present (written at container boot).
 * - Forwards args to the `story` CLI.
 *
 * This wrapper intentionally does not require auth up-front: `story health` and
 * `story login` can run without STORY_TOKEN.
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

function usage() {
  console.error('Usage:');
  console.error('  node story.cjs <story-cli args...>');
  console.error('');
  console.error('Examples:');
  console.error('  node story.cjs --version');
  console.error('  node story.cjs health');
  console.error('  node story.cjs project list --json');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  loadOpenClawEnv();

  const r = spawnSync('story', args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });

  if (typeof r.status === 'number') process.exit(r.status);
  process.exit(1);
}

main();
