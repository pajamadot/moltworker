#!/usr/bin/env node
/**
 * PajamaDot Story skill wrapper.
 *
 * This is intentionally thin: it validates STORY_TOKEN exists and then forwards
 * args to the `story` CLI installed in the container image.
 */

const { spawnSync } = require('node:child_process');

function usage() {
  console.error('Usage:');
  console.error('  node story.js <story-cli args...>');
  console.error('');
  console.error('Examples:');
  console.error('  node story.js project list --json');
  console.error('  node story.js story list --json');
  console.error('  node story.js use project <project-id>');
  console.error('  node story.js use story <story-id>');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  if (!process.env.STORY_TOKEN || String(process.env.STORY_TOKEN).trim() === '') {
    console.error('Error: STORY_TOKEN is not set (expected a token like sp_live_...)');
    process.exit(1);
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

