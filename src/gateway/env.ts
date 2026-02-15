import type { MoltbotEnv } from '../types';

/**
 * Build environment variables to pass to the OpenClaw container process
 *
 * @param env - Worker environment bindings
 * @returns Environment variables record
 */
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Cloudflare AI Gateway configuration (new native provider)
  if (env.CLOUDFLARE_AI_GATEWAY_API_KEY) {
    envVars.CLOUDFLARE_AI_GATEWAY_API_KEY = env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  }
  if (env.CF_AI_GATEWAY_ACCOUNT_ID) {
    envVars.CF_AI_GATEWAY_ACCOUNT_ID = env.CF_AI_GATEWAY_ACCOUNT_ID;
  }
  if (env.CF_AI_GATEWAY_GATEWAY_ID) {
    envVars.CF_AI_GATEWAY_GATEWAY_ID = env.CF_AI_GATEWAY_GATEWAY_ID;
  }

  // Direct provider keys
  if (env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = env.OPENAI_API_KEY;

  // Legacy AI Gateway support: AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY
  // When set, these override direct keys for backward compatibility
  if (env.AI_GATEWAY_API_KEY && env.AI_GATEWAY_BASE_URL) {
    const normalizedBaseUrl = env.AI_GATEWAY_BASE_URL.replace(/\/+$/, '');
    envVars.AI_GATEWAY_BASE_URL = normalizedBaseUrl;
    // Legacy path routes through Anthropic base URL
    envVars.ANTHROPIC_BASE_URL = normalizedBaseUrl;
    envVars.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
  } else if (env.ANTHROPIC_BASE_URL) {
    envVars.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
  }

  // Map MOLTBOT_GATEWAY_TOKEN to OPENCLAW_GATEWAY_TOKEN (container expects this name)
  if (env.MOLTBOT_GATEWAY_TOKEN) envVars.OPENCLAW_GATEWAY_TOKEN = env.MOLTBOT_GATEWAY_TOKEN;
  if (env.DEV_MODE) envVars.OPENCLAW_DEV_MODE = env.DEV_MODE;
  if (env.TELEGRAM_BOT_TOKEN) envVars.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_DM_POLICY) envVars.TELEGRAM_DM_POLICY = env.TELEGRAM_DM_POLICY;
  if (env.DISCORD_BOT_TOKEN) envVars.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN;
  if (env.DISCORD_DM_POLICY) envVars.DISCORD_DM_POLICY = env.DISCORD_DM_POLICY;
  if (env.SLACK_BOT_TOKEN) envVars.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_APP_TOKEN) envVars.SLACK_APP_TOKEN = env.SLACK_APP_TOKEN;
  if (env.FEISHU_APP_ID) envVars.FEISHU_APP_ID = env.FEISHU_APP_ID;
  if (env.FEISHU_APP_SECRET) envVars.FEISHU_APP_SECRET = env.FEISHU_APP_SECRET;
  if (env.FEISHU_DOMAIN) envVars.FEISHU_DOMAIN = env.FEISHU_DOMAIN;
  if (env.FEISHU_CONNECTION_MODE) envVars.FEISHU_CONNECTION_MODE = env.FEISHU_CONNECTION_MODE;
  if (env.FEISHU_DM_POLICY) envVars.FEISHU_DM_POLICY = env.FEISHU_DM_POLICY;
  if (env.FEISHU_GROUP_POLICY) envVars.FEISHU_GROUP_POLICY = env.FEISHU_GROUP_POLICY;
  if (env.FEISHU_REQUIRE_MENTION) envVars.FEISHU_REQUIRE_MENTION = env.FEISHU_REQUIRE_MENTION;
  if (env.CF_AI_GATEWAY_MODEL) envVars.CF_AI_GATEWAY_MODEL = env.CF_AI_GATEWAY_MODEL;
  if (env.CF_ACCOUNT_ID) envVars.CF_ACCOUNT_ID = env.CF_ACCOUNT_ID;
  if (env.CDP_SECRET) envVars.CDP_SECRET = env.CDP_SECRET;
  if (env.WORKER_URL) envVars.WORKER_URL = env.WORKER_URL;
  if (env.OPENCLAW_ASSISTANT_NAME) envVars.OPENCLAW_ASSISTANT_NAME = env.OPENCLAW_ASSISTANT_NAME;
  if (env.OPENCLAW_ASSISTANT_AVATAR) envVars.OPENCLAW_ASSISTANT_AVATAR = env.OPENCLAW_ASSISTANT_AVATAR;

  // Game Dev Memory (optional)
  if (env.GDM_API_URL) envVars.GDM_API_URL = env.GDM_API_URL;
  if (env.GDM_API_TOKEN) envVars.GDM_API_TOKEN = env.GDM_API_TOKEN;
  if (env.GDM_PROJECT_ID) envVars.GDM_PROJECT_ID = env.GDM_PROJECT_ID;

  // PajamaDot Story CLI (optional)
  if (env.STORY_TOKEN) envVars.STORY_TOKEN = env.STORY_TOKEN;
  if (env.STORY_API_URL) envVars.STORY_API_URL = env.STORY_API_URL;
  if (env.STORY_ASSET_URL) envVars.STORY_ASSET_URL = env.STORY_ASSET_URL;
  if (env.STORY_GENERATION_URL) envVars.STORY_GENERATION_URL = env.STORY_GENERATION_URL;
  if (env.STORY_AUTH_URL) envVars.STORY_AUTH_URL = env.STORY_AUTH_URL;
  if (env.STORY_CDN_URL) envVars.STORY_CDN_URL = env.STORY_CDN_URL;
  if (env.STORY_OAUTH_CALLBACK_TIMEOUT_SECS) {
    envVars.STORY_OAUTH_CALLBACK_TIMEOUT_SECS = env.STORY_OAUTH_CALLBACK_TIMEOUT_SECS;
  }

  // R2 persistence credentials (used by rclone in start-openclaw.sh)
  if (env.R2_ACCESS_KEY_ID) envVars.R2_ACCESS_KEY_ID = env.R2_ACCESS_KEY_ID;
  if (env.R2_SECRET_ACCESS_KEY) envVars.R2_SECRET_ACCESS_KEY = env.R2_SECRET_ACCESS_KEY;
  if (env.R2_BUCKET_NAME) envVars.R2_BUCKET_NAME = env.R2_BUCKET_NAME;

  return envVars;
}
