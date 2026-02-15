/**
 * Moltbot + Cloudflare Sandbox
 *
 * This Worker runs Moltbot personal AI assistant in a Cloudflare Sandbox container.
 * It proxies all requests to the Moltbot Gateway's web UI and WebSocket endpoint.
 *
 * Features:
 * - Web UI (Control Dashboard + WebChat) at /
 * - WebSocket support for real-time communication
 * - Admin UI at /_admin/ for device management
 * - Configuration via environment secrets
 *
 * Required secrets (set via `wrangler secret put`):
 * - ANTHROPIC_API_KEY: Your Anthropic API key
 *
 * Optional secrets:
 * - MOLTBOT_GATEWAY_TOKEN: Token to protect gateway access
 * - TELEGRAM_BOT_TOKEN: Telegram bot token
 * - DISCORD_BOT_TOKEN: Discord bot token
 * - SLACK_BOT_TOKEN + SLACK_APP_TOKEN: Slack tokens
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getSandbox, Sandbox, type SandboxOptions } from '@cloudflare/sandbox';

import type { AppEnv, MoltbotEnv } from './types';
import { MOLTBOT_PORT } from './config';
import { createAccessMiddleware } from './auth';
import { findExistingMoltbotProcess, startMoltbotGateway } from './gateway';
import { publicRoutes, api, adminUi, debug, cdp } from './routes';
import { redactSensitiveParams } from './utils/logging';
import { TimeoutError } from './utils/timeout';
import loadingPageHtml from './assets/loading.html';
import configErrorHtml from './assets/config-error.html';

/**
 * Transform error messages from the gateway to be more user-friendly.
 */
function transformErrorMessage(message: string, host: string): string {
  if (message.includes('gateway token missing') || message.includes('gateway token mismatch')) {
    return `Invalid or missing token. Visit https://${host}?token={REPLACE_WITH_YOUR_TOKEN}`;
  }

  if (message.includes('pairing required')) {
    return `Pairing required. Approve this device at https://${host}/_admin/ then refresh this page.`;
  }

  return message;
}

function hasCloudflareAccessSession(request: Request): boolean {
  // If the user put Cloudflare Access in front of the Control UI (root),
  // the browser will include either the assertion header (rare) or the cookie.
  if (request.headers.get('CF-Access-JWT-Assertion')) return true;
  const cookie = request.headers.get('Cookie') || '';
  return cookie.includes('CF_Authorization=');
}

function buildForwardedHeaders(request: Request, url: URL): Headers {
  const headers = new Headers(request.headers);

  // Preserve original client IP for services behind the sandbox proxy (OpenClaw pairing, logs, etc).
  // Cloudflare adds CF-Connecting-IP; ensure X-Forwarded-For is present for typical proxy stacks.
  if (!headers.has('x-forwarded-for')) {
    const cfIp = headers.get('cf-connecting-ip');
    if (cfIp) headers.set('x-forwarded-for', cfIp);
  }
  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  }
  if (!headers.has('x-forwarded-host')) {
    headers.set('x-forwarded-host', url.host);
  }

  return headers;
}

function cloneResponseWithHeaders(resp: Response, extra: Record<string, string>): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);

  // Preserve multi-value Set-Cookie (Cloudflare Workers supports Headers.getSetCookie()).
  const getSetCookie = (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie.call(resp.headers as unknown as Headers);
    if (Array.isArray(cookies) && cookies.length > 0) {
      headers.delete('set-cookie');
      for (const c of cookies) headers.append('set-cookie', c);
    }
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

export { Sandbox };

/**
 * Validate required environment variables.
 * Returns an array of missing variable descriptions, or empty array if all are set.
 */
function validateRequiredEnv(env: MoltbotEnv): string[] {
  const missing: string[] = [];
  const isTestMode = env.DEV_MODE === 'true' || env.E2E_TEST_MODE === 'true';

  if (!env.MOLTBOT_GATEWAY_TOKEN) {
    missing.push('MOLTBOT_GATEWAY_TOKEN');
  }

  // CF Access vars not required in dev/test mode since auth is skipped
  if (!isTestMode) {
    if (!env.CF_ACCESS_TEAM_DOMAIN) {
      missing.push('CF_ACCESS_TEAM_DOMAIN');
    }

    if (!env.CF_ACCESS_AUD) {
      missing.push('CF_ACCESS_AUD');
    }
  }

  // Check for AI provider configuration (at least one must be set)
  const hasCloudflareGateway = !!(
    env.CLOUDFLARE_AI_GATEWAY_API_KEY &&
    env.CF_AI_GATEWAY_ACCOUNT_ID &&
    env.CF_AI_GATEWAY_GATEWAY_ID
  );
  const hasLegacyGateway = !!(env.AI_GATEWAY_API_KEY && env.AI_GATEWAY_BASE_URL);
  const hasAnthropicKey = !!env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!env.OPENAI_API_KEY;

  if (!hasCloudflareGateway && !hasLegacyGateway && !hasAnthropicKey && !hasOpenAIKey) {
    missing.push(
      'ANTHROPIC_API_KEY, OPENAI_API_KEY, or CLOUDFLARE_AI_GATEWAY_API_KEY + CF_AI_GATEWAY_ACCOUNT_ID + CF_AI_GATEWAY_GATEWAY_ID',
    );
  }

  return missing;
}

/**
 * Build sandbox options based on environment configuration.
 *
 * SANDBOX_SLEEP_AFTER controls how long the container stays alive after inactivity:
 * - 'never' (default): Container stays alive indefinitely (recommended due to long cold starts)
 * - Duration string: e.g., '10m', '1h', '30s' - container sleeps after this period of inactivity
 *
 * To reduce costs at the expense of cold start latency, set SANDBOX_SLEEP_AFTER to a duration:
 *   npx wrangler secret put SANDBOX_SLEEP_AFTER
 *   # Enter: 10m (or 1h, 30m, etc.)
 */
function buildSandboxOptions(env: MoltbotEnv): SandboxOptions {
  const sleepAfter = env.SANDBOX_SLEEP_AFTER?.toLowerCase() || 'never';

  // 'never' means keep the container alive indefinitely
  if (sleepAfter === 'never') {
    return { keepAlive: true };
  }

  // Otherwise, use the specified duration
  return { sleepAfter };
}

// Main app
const app = new Hono<AppEnv>();

// =============================================================================
// MIDDLEWARE: Applied to ALL routes
// =============================================================================

// Middleware: Log every request
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  const redactedSearch = redactSensitiveParams(url);
  console.log(`[REQ] ${c.req.method} ${url.pathname}${redactedSearch}`);
  console.log(`[REQ] Has ANTHROPIC_API_KEY: ${!!c.env.ANTHROPIC_API_KEY}`);
  console.log(`[REQ] DEV_MODE: ${c.env.DEV_MODE}`);
  console.log(`[REQ] DEBUG_ROUTES: ${c.env.DEBUG_ROUTES}`);
  await next();
});

// Middleware: Initialize sandbox for all requests
app.use('*', async (c, next) => {
  const options = buildSandboxOptions(c.env);
  const sandbox = getSandbox(c.env.Sandbox, 'moltbot', options);
  c.set('sandbox', sandbox);
  await next();
});

// =============================================================================
// PUBLIC ROUTES: No Cloudflare Access authentication required
// =============================================================================

// Mount public routes first (before auth middleware)
// Includes: /sandbox-health, /logo.png, /logo-small.png, /api/status, /_admin/assets/*
app.route('/', publicRoutes);

// Mount CDP routes (uses shared secret auth via query param, not CF Access)
app.route('/cdp', cdp);

// =============================================================================
// PROTECTED ROUTES: Cloudflare Access authentication required
// =============================================================================

// Middleware: Validate required environment variables (skip in dev mode and for debug routes)
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);

  // Skip validation for debug routes (they have their own enable check)
  if (url.pathname.startsWith('/debug')) {
    return next();
  }

  // Skip validation in dev mode
  if (c.env.DEV_MODE === 'true') {
    return next();
  }

  const missingVars = validateRequiredEnv(c.env);
  if (missingVars.length > 0) {
    console.error('[CONFIG] Missing required environment variables:', missingVars.join(', '));

    const acceptsHtml = c.req.header('Accept')?.includes('text/html');
    if (acceptsHtml) {
      // Return a user-friendly HTML error page
      const html = configErrorHtml.replace('{{MISSING_VARS}}', missingVars.join(', '));
      return c.html(html, 503);
    }

    // Return JSON error for API requests
    return c.json(
      {
        error: 'Configuration error',
        message: 'Required environment variables are not configured',
        missing: missingVars,
        hint: 'Set these using: wrangler secret put <VARIABLE_NAME>',
      },
      503,
    );
  }

  return next();
});

// Cloudflare Access authentication for protected routes.
//
// Important: We intentionally do NOT protect the Control UI (catch-all proxy)
// with Cloudflare Access here. The gateway is already protected by:
// - MOLTBOT_GATEWAY_TOKEN (required for remote access)
// - device pairing (default)
//
// We only require Cloudflare Access for administrative surfaces.
function getAccessMiddlewareForRequest(c: Context<AppEnv>) {
  const acceptsHtml = c.req.header('Accept')?.includes('text/html');
  return createAccessMiddleware({
    type: acceptsHtml ? 'html' : 'json',
    redirectOnMissing: acceptsHtml,
  });
}

app.use('/api/*', async (c, next) => {
  // Keep the public status endpoint unauthenticated.
  const path = new URL(c.req.url).pathname;
  if (path === '/api/status' || path === '/api/restart') return next();
  const mw = getAccessMiddlewareForRequest(c);
  return mw(c, next);
});

app.use('/_admin/*', async (c, next) => {
  // Static assets are public so the admin SPA can load during auth flows.
  if (new URL(c.req.url).pathname.startsWith('/_admin/assets/')) return next();
  const mw = getAccessMiddlewareForRequest(c);
  return mw(c, next);
});

// Mount API routes (protected by Cloudflare Access)
app.route('/api', api);

// Mount Admin UI routes (protected by Cloudflare Access)
app.route('/_admin', adminUi);

// Mount debug routes (protected by Cloudflare Access, only when DEBUG_ROUTES is enabled)
app.use('/debug/*', async (c, next) => {
  if (c.env.DEBUG_ROUTES !== 'true') {
    return c.json({ error: 'Debug routes are disabled' }, 404);
  }
  const mw = getAccessMiddlewareForRequest(c);
  return mw(c, next);
});
app.route('/debug', debug);

// =============================================================================
// CATCH-ALL: Proxy to Moltbot gateway
// =============================================================================

app.all('*', async (c) => {
  const sandbox = c.get('sandbox');
  const request = c.req.raw;
  const url = new URL(request.url);

  console.log('[PROXY] Handling request:', url.pathname);

  // Check if a gateway process exists AND is actually listening.
  // Important: only using proc.status ("running") is not sufficient; we can have a stuck process.
  let existingProcess = null;
  let sandboxBusy = false;
  try {
    existingProcess = await findExistingMoltbotProcess(sandbox);
  } catch (e) {
    if (e instanceof TimeoutError) {
      sandboxBusy = true;
    } else {
      throw e;
    }
  }
  let isGatewayReady = false;
  if (existingProcess) {
    try {
      // Use a very short probe. Long-running waitForPort calls can block the Sandbox durable object
      // and make /api/status hang, which freezes the loading page.
      await existingProcess.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: 500 });
      isGatewayReady = true;
    } catch {
      isGatewayReady = false;
    }
  }

  // For browser requests (non-WebSocket, non-API), show loading page if gateway isn't ready
  const isWebSocketRequest = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  const acceptsHtml = request.headers.get('Accept')?.includes('text/html');

  if (!isGatewayReady) {
    console.log('[PROXY] Gateway not ready, triggering background start');

    // Start the gateway in the background (non-blocking), unless the sandbox is currently busy
    // (e.g. another request is starting the container). Starting again is usually safe, but can
    // create noisy duplicate starts under load.
    if (!sandboxBusy) {
      c.executionCtx.waitUntil(
        startMoltbotGateway(sandbox, c.env).catch((err: Error) => {
          console.error('[PROXY] Background gateway start failed:', err);
        }),
      );
    }

    if (!isWebSocketRequest && acceptsHtml) {
      // Return the loading page immediately (it polls /api/status).
      return c.html(loadingPageHtml);
    }

    // Non-HTML requests (including WebSocket handshakes) should fail fast while the gateway boots.
    return c.json(
      {
        error: 'Gateway is starting',
        status: 'starting',
        hint: 'Wait ~1-2 minutes, then retry. You can also open /_admin/ and restart the gateway.',
      },
      503,
    );
  }

  // Proxy to Moltbot with WebSocket message interception
  if (isWebSocketRequest) {
    const debugLogs = c.env.DEBUG_ROUTES === 'true';
    const redactedSearch = redactSensitiveParams(url);

    console.log('[WS] Proxying WebSocket connection to Moltbot');
    if (debugLogs) {
      console.log('[WS] URL:', url.pathname + redactedSearch);
    }

    // If the Control UI is protected by Cloudflare Access, the login redirect can drop query params
    // like ?token=... . To keep token auth working in that setup, inject the gateway token ONLY
    // when we detect an active Access session (cookie/header present).
    const wsUrl = new URL(url.toString());
    if (
      c.env.MOLTBOT_GATEWAY_TOKEN &&
      !wsUrl.searchParams.has('token') &&
      hasCloudflareAccessSession(request)
    ) {
      wsUrl.searchParams.set('token', c.env.MOLTBOT_GATEWAY_TOKEN);
    }

    const wsHeaders = buildForwardedHeaders(request, wsUrl);
    const wsRequest = new Request(wsUrl.toString(), {
      method: request.method,
      headers: wsHeaders,
    });

    // Get WebSocket connection to the container
    const containerResponse = await sandbox.wsConnect(wsRequest, MOLTBOT_PORT);
    console.log('[WS] wsConnect response status:', containerResponse.status);

    // Get the container-side WebSocket
    const containerWs = containerResponse.webSocket;
    if (!containerWs) {
      console.error('[WS] No WebSocket in container response - falling back to direct proxy');
      return containerResponse;
    }

    if (debugLogs) {
      console.log('[WS] Got container WebSocket, setting up interception');
    }

    // Create a WebSocket pair for the client
    const [clientWs, serverWs] = Object.values(new WebSocketPair());

    // Accept both WebSockets
    serverWs.accept();
    containerWs.accept();

    if (debugLogs) {
      console.log('[WS] Both WebSockets accepted');
      console.log('[WS] containerWs.readyState:', containerWs.readyState);
      console.log('[WS] serverWs.readyState:', serverWs.readyState);
    }

    // Relay messages from client to container
    serverWs.addEventListener('message', (event) => {
      if (debugLogs) {
        console.log(
          '[WS] Client -> Container:',
          typeof event.data,
          typeof event.data === 'string' ? event.data.slice(0, 200) : '(binary)',
        );
      }
      if (containerWs.readyState === WebSocket.OPEN) {
        containerWs.send(event.data);
      } else if (debugLogs) {
        console.log('[WS] Container not open, readyState:', containerWs.readyState);
      }
    });

    // Relay messages from container to client, with error transformation
    containerWs.addEventListener('message', (event) => {
      if (debugLogs) {
        console.log(
          '[WS] Container -> Client (raw):',
          typeof event.data,
          typeof event.data === 'string' ? event.data.slice(0, 500) : '(binary)',
        );
      }
      let data = event.data;

      // Try to intercept and transform error messages
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          if (debugLogs) {
            console.log('[WS] Parsed JSON, has error.message:', !!parsed.error?.message);
          }
          if (parsed.error?.message) {
            if (debugLogs) {
              console.log('[WS] Original error.message:', parsed.error.message);
            }
            parsed.error.message = transformErrorMessage(parsed.error.message, url.host);
            if (debugLogs) {
              console.log('[WS] Transformed error.message:', parsed.error.message);
            }
            data = JSON.stringify(parsed);
          }
        } catch (e) {
          if (debugLogs) {
            console.log('[WS] Not JSON or parse error:', e);
          }
        }
      }

      if (serverWs.readyState === WebSocket.OPEN) {
        serverWs.send(data);
      } else if (debugLogs) {
        console.log('[WS] Server not open, readyState:', serverWs.readyState);
      }
    });

    // Handle close events
    serverWs.addEventListener('close', (event) => {
      if (debugLogs) {
        console.log('[WS] Client closed:', event.code, event.reason);
      }
      containerWs.close(event.code, event.reason);
    });

    containerWs.addEventListener('close', (event) => {
      if (debugLogs) {
        console.log('[WS] Container closed:', event.code, event.reason);
      }
      // Transform the close reason (truncate to 123 bytes max for WebSocket spec)
      let reason = transformErrorMessage(event.reason, url.host);
      if (reason.length > 123) {
        reason = reason.slice(0, 120) + '...';
      }
      if (debugLogs) {
        console.log('[WS] Transformed close reason:', reason);
      }
      serverWs.close(event.code, reason);
    });

    // Handle errors
    serverWs.addEventListener('error', (event) => {
      console.error('[WS] Client error:', event);
      containerWs.close(1011, 'Client error');
    });

    containerWs.addEventListener('error', (event) => {
      console.error('[WS] Container error:', event);
      serverWs.close(1011, 'Container error');
    });

    if (debugLogs) {
      console.log('[WS] Returning intercepted WebSocket response');
    }
    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    });
  }

  console.log('[HTTP] Proxying:', url.pathname + url.search);

  // Same rationale as WebSocket injection above: only auto-inject token for Access-protected setups.
  const proxyUrl = new URL(url.toString());
  if (
    c.env.MOLTBOT_GATEWAY_TOKEN &&
    !proxyUrl.searchParams.has('token') &&
    hasCloudflareAccessSession(request)
  ) {
    proxyUrl.searchParams.set('token', c.env.MOLTBOT_GATEWAY_TOKEN);
  }

  const proxyHeaders = buildForwardedHeaders(request, proxyUrl);
  const proxyRequest = new Request(proxyUrl.toString(), {
    method: request.method,
    headers: proxyHeaders,
    body: request.body,
    redirect: 'manual',
  });

  const httpResponse = await sandbox.containerFetch(proxyRequest, MOLTBOT_PORT);
  console.log('[HTTP] Response status:', httpResponse.status);

  const debugHeaders = { 'X-Worker-Debug': 'proxy-to-moltbot', 'X-Debug-Path': url.pathname };

  // Rewrite Control UI HTML for branding (title only; icons are served by worker routes).
  // Use HTMLRewriter to avoid breaking headers like Set-Cookie that some browsers use to persist device identity.
  const contentType = httpResponse.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const rewriter = new HTMLRewriter().on('title', {
      element(el) {
        el.setInnerContent('ClayClaw Control');
      },
    });
    const transformed = rewriter.transform(httpResponse);
    const resp = cloneResponseWithHeaders(transformed, debugHeaders);
    resp.headers.delete('content-length');
    return resp;
  }

  return cloneResponseWithHeaders(httpResponse, debugHeaders);
});

export default {
  fetch: app.fetch,
};
