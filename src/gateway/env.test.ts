import { describe, it, expect } from 'vitest';
import { buildEnvVars } from './env';
import { createMockEnv } from '../test-utils';

describe('buildEnvVars', () => {
  it('returns empty object when no env vars set', () => {
    const env = createMockEnv();
    const result = buildEnvVars(env);
    expect(result).toEqual({});
  });

  it('includes ANTHROPIC_API_KEY when set directly', () => {
    const env = createMockEnv({ ANTHROPIC_API_KEY: 'sk-test-key' });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-test-key');
  });

  it('includes OPENAI_API_KEY when set directly', () => {
    const env = createMockEnv({ OPENAI_API_KEY: 'sk-openai-key' });
    const result = buildEnvVars(env);
    expect(result.OPENAI_API_KEY).toBe('sk-openai-key');
  });

  // Cloudflare AI Gateway (new native provider)
  it('passes Cloudflare AI Gateway env vars', () => {
    const env = createMockEnv({
      CLOUDFLARE_AI_GATEWAY_API_KEY: 'cf-gw-key',
      CF_AI_GATEWAY_ACCOUNT_ID: 'my-account-id',
      CF_AI_GATEWAY_GATEWAY_ID: 'my-gateway-id',
    });
    const result = buildEnvVars(env);
    expect(result.CLOUDFLARE_AI_GATEWAY_API_KEY).toBe('cf-gw-key');
    expect(result.CF_AI_GATEWAY_ACCOUNT_ID).toBe('my-account-id');
    expect(result.CF_AI_GATEWAY_GATEWAY_ID).toBe('my-gateway-id');
  });

  it('passes Cloudflare AI Gateway alongside direct Anthropic key', () => {
    const env = createMockEnv({
      CLOUDFLARE_AI_GATEWAY_API_KEY: 'cf-gw-key',
      CF_AI_GATEWAY_ACCOUNT_ID: 'my-account-id',
      CF_AI_GATEWAY_GATEWAY_ID: 'my-gateway-id',
      ANTHROPIC_API_KEY: 'sk-anthro',
    });
    const result = buildEnvVars(env);
    expect(result.CLOUDFLARE_AI_GATEWAY_API_KEY).toBe('cf-gw-key');
    expect(result.ANTHROPIC_API_KEY).toBe('sk-anthro');
  });

  // Legacy AI Gateway support
  it('maps legacy AI_GATEWAY_API_KEY to ANTHROPIC_API_KEY with base URL', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('sk-gateway-key');
    expect(result.ANTHROPIC_BASE_URL).toBe(
      'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    );
    expect(result.AI_GATEWAY_BASE_URL).toBe(
      'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    );
  });

  it('legacy AI_GATEWAY_* overrides direct ANTHROPIC_API_KEY', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.example.com/anthropic',
      ANTHROPIC_API_KEY: 'direct-key',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('gateway-key');
    expect(result.AI_GATEWAY_BASE_URL).toBe('https://gateway.example.com/anthropic');
  });

  it('strips trailing slashes from legacy AI_GATEWAY_BASE_URL', () => {
    const env = createMockEnv({
      AI_GATEWAY_API_KEY: 'sk-gateway-key',
      AI_GATEWAY_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic///',
    });
    const result = buildEnvVars(env);
    expect(result.AI_GATEWAY_BASE_URL).toBe(
      'https://gateway.ai.cloudflare.com/v1/123/my-gw/anthropic',
    );
  });

  it('falls back to ANTHROPIC_BASE_URL when no AI_GATEWAY_BASE_URL', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'direct-key',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    const result = buildEnvVars(env);
    expect(result.ANTHROPIC_API_KEY).toBe('direct-key');
    expect(result.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });

  // Gateway token mapping
  it('maps MOLTBOT_GATEWAY_TOKEN to OPENCLAW_GATEWAY_TOKEN for container', () => {
    const env = createMockEnv({ MOLTBOT_GATEWAY_TOKEN: 'my-token' });
    const result = buildEnvVars(env);
    expect(result.OPENCLAW_GATEWAY_TOKEN).toBe('my-token');
  });

  // Channel tokens
  it('includes all channel tokens when set', () => {
    const env = createMockEnv({
      TELEGRAM_BOT_TOKEN: 'tg-token',
      TELEGRAM_DM_POLICY: 'pairing',
      DISCORD_BOT_TOKEN: 'discord-token',
      DISCORD_DM_POLICY: 'open',
      SLACK_BOT_TOKEN: 'slack-bot',
      SLACK_APP_TOKEN: 'slack-app',
    });
    const result = buildEnvVars(env);

    expect(result.TELEGRAM_BOT_TOKEN).toBe('tg-token');
    expect(result.TELEGRAM_DM_POLICY).toBe('pairing');
    expect(result.DISCORD_BOT_TOKEN).toBe('discord-token');
    expect(result.DISCORD_DM_POLICY).toBe('open');
    expect(result.SLACK_BOT_TOKEN).toBe('slack-bot');
    expect(result.SLACK_APP_TOKEN).toBe('slack-app');
  });

  it('passes Feishu plugin env vars to container', () => {
    const env = createMockEnv({
      FEISHU_APP_ID: 'cli_xxx',
      FEISHU_APP_SECRET: 'secret',
      FEISHU_DOMAIN: 'lark',
      FEISHU_CONNECTION_MODE: 'websocket',
      FEISHU_DM_POLICY: 'pairing',
      FEISHU_GROUP_POLICY: 'open',
      FEISHU_REQUIRE_MENTION: 'true',
    });
    const result = buildEnvVars(env);
    expect(result.FEISHU_APP_ID).toBe('cli_xxx');
    expect(result.FEISHU_APP_SECRET).toBe('secret');
    expect(result.FEISHU_DOMAIN).toBe('lark');
    expect(result.FEISHU_CONNECTION_MODE).toBe('websocket');
    expect(result.FEISHU_DM_POLICY).toBe('pairing');
    expect(result.FEISHU_GROUP_POLICY).toBe('open');
    expect(result.FEISHU_REQUIRE_MENTION).toBe('true');
  });

  it('maps DEV_MODE to OPENCLAW_DEV_MODE for container', () => {
    const env = createMockEnv({
      DEV_MODE: 'true',
    });
    const result = buildEnvVars(env);
    expect(result.OPENCLAW_DEV_MODE).toBe('true');
  });

  // AI Gateway model override
  it('passes CF_AI_GATEWAY_MODEL to container', () => {
    const env = createMockEnv({
      CF_AI_GATEWAY_MODEL: 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    });
    const result = buildEnvVars(env);
    expect(result.CF_AI_GATEWAY_MODEL).toBe('workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('passes CF_ACCOUNT_ID to container', () => {
    const env = createMockEnv({ CF_ACCOUNT_ID: 'acct-123' });
    const result = buildEnvVars(env);
    expect(result.CF_ACCOUNT_ID).toBe('acct-123');
  });

  it('passes OpenClaw Control UI branding env vars to container', () => {
    const env = createMockEnv({
      OPENCLAW_ASSISTANT_NAME: 'ClayClaw',
      OPENCLAW_ASSISTANT_AVATAR: 'C',
    });
    const result = buildEnvVars(env);
    expect(result.OPENCLAW_ASSISTANT_NAME).toBe('ClayClaw');
    expect(result.OPENCLAW_ASSISTANT_AVATAR).toBe('C');
  });

  it('passes Game Dev Memory env vars to container', () => {
    const env = createMockEnv({
      GDM_API_URL: 'https://api-game-dev-memory.pajamadot.com',
      GDM_API_TOKEN: 'gdm_test_token',
      GDM_PROJECT_ID: 'proj-123',
    });
    const result = buildEnvVars(env);
    expect(result.GDM_API_URL).toBe('https://api-game-dev-memory.pajamadot.com');
    expect(result.GDM_API_TOKEN).toBe('gdm_test_token');
    expect(result.GDM_PROJECT_ID).toBe('proj-123');
  });

  it('passes Story CLI env vars to container', () => {
    const env = createMockEnv({
      STORY_TOKEN: 'sp_live_test',
      STORY_API_URL: 'https://api.pajamadot.com',
    });
    const result = buildEnvVars(env);
    expect(result.STORY_TOKEN).toBe('sp_live_test');
    expect(result.STORY_API_URL).toBe('https://api.pajamadot.com');
  });

  it('combines all env vars correctly', () => {
    const env = createMockEnv({
      ANTHROPIC_API_KEY: 'sk-key',
      MOLTBOT_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
    const result = buildEnvVars(env);

    expect(result).toEqual({
      ANTHROPIC_API_KEY: 'sk-key',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      TELEGRAM_BOT_TOKEN: 'tg',
    });
  });
});
