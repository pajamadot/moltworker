---
name: model-switch
description: Switch OpenClaw's default LLM model/provider by editing openclaw.json (and optionally restarting the gateway). Supports direct providers and Cloudflare AI Gateway.
tags: [llm, model, config, restart]
---

# Model Switch

This skill lets the agent change the **default inference model** OpenClaw uses (the value of `agents.defaults.model.primary`) without rebuilding the container image.

It works by editing `/root/.openclaw/openclaw.json` (which is persisted to R2 if you enabled storage sync). Optionally, it can also restart the gateway so the change takes effect immediately.

## Quick Start

Show current default model:

```bash
node {baseDir}/scripts/model.cjs get
```

List configured providers + models:

```bash
node {baseDir}/scripts/model.cjs list
```

Switch to a direct-provider model (provider must exist in config):

```bash
node {baseDir}/scripts/model.cjs set anthropic/claude-3-5-haiku-latest
```

Switch via Cloudflare AI Gateway (creates/updates a `cf-ai-gw-*` provider entry):

```bash
node {baseDir}/scripts/model.cjs set anthropic/claude-3-5-haiku-latest --ai-gateway
```

## Notes

- If you have `CF_AI_GATEWAY_MODEL` set as a Worker secret, it will override the model on every boot. For runtime switching, delete that secret and use this skill instead.
- Auto-restart uses `WORKER_URL` + `OPENCLAW_GATEWAY_TOKEN` to call `POST /api/restart?token=...`. If those aren't available to the tool sandbox, the script will update the config and print a manual restart hint.

