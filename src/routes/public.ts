import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { MOLTBOT_PORT } from '../config';
import { ensureMoltbotGateway, findExistingMoltbotProcess, startMoltbotGateway } from '../gateway';
import { TimeoutError, withTimeout } from '../utils/timeout';

/**
 * Public routes - NO Cloudflare Access authentication required
 *
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'moltbot-sandbox',
    gateway_port: MOLTBOT_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// OpenClaw Control UI assets (favicon, etc.)
// These files are referenced by the gateway UI HTML at "/".
publicRoutes.get('/favicon.svg', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});
publicRoutes.get('/favicon-32.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});
// Many browsers still probe /favicon.ico by default. Serve our favicon there too.
publicRoutes.get('/favicon.ico', (c) => {
  const url = new URL(c.req.url);
  const assetUrl = new URL('/favicon-32.png', url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});
publicRoutes.get('/apple-touch-icon.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /oauth/discord/callback - Optional OAuth2 redirect landing page (public)
//
// This is only needed if you add `redirect_uri` to your Discord OAuth2 URL (e.g. an "install" link
// that returns the user to your domain). Moltworker/OpenClaw does NOT require Discord OAuth2 for
// normal bot-token operation, but having a safe landing page reduces setup confusion.
publicRoutes.get('/oauth/discord/callback', (c) => {
  const url = new URL(c.req.url);
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  const adminUrl = new URL('/_admin/', url.origin).toString();
  const rootUrl = new URL('/', url.origin).toString();

  // Never echo OAuth codes/tokens back into the page.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Discord Redirect</title>
    <style>
      :root { color-scheme: dark light; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; }
      .card { max-width: 720px; margin: 0 auto; padding: 20px; border: 1px solid rgba(0,0,0,0.12); border-radius: 12px; }
      h1 { margin: 0 0 10px; font-size: 20px; }
      p { margin: 0 0 10px; line-height: 1.5; opacity: 0.9; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.95em; }
      .links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
      a { display: inline-block; padding: 10px 12px; border-radius: 10px; text-decoration: none; border: 1px solid rgba(0,0,0,0.18); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${error ? 'Discord authorization failed' : 'Discord authorization complete'}</h1>
      ${
        error
          ? `<p><strong>Error:</strong> <code>${error}</code></p>${
              errorDesc ? `<p>${errorDesc}</p>` : ''
            }`
          : `<p>You can close this tab. If you are setting up the bot with DM pairing, the next step is to approve the pairing code in the admin UI.</p>
             <p>Admin UI: <code>${adminUrl}</code></p>`
      }
      <div class="links">
        <a href="${adminUrl}">Open Admin UI</a>
        <a href="${rootUrl}">Open Control UI</a>
      </div>
    </div>
  </body>
</html>`;

  return c.html(html);
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');
  const url = new URL(c.req.url);
  const now = Date.now();

  const wantDetails = url.searchParams.get('details') === 'true' || url.searchParams.get('debug') === '1';
  const token = url.searchParams.get('token');
  const allowDetails =
    wantDetails &&
    typeof token === 'string' &&
    token.length > 0 &&
    !!c.env.MOLTBOT_GATEWAY_TOKEN &&
    token === c.env.MOLTBOT_GATEWAY_TOKEN;

  function redactSecrets(input: string): string {
    const secrets = [
      c.env.MOLTBOT_GATEWAY_TOKEN,
      c.env.ANTHROPIC_API_KEY,
      c.env.OPENAI_API_KEY,
      c.env.AI_GATEWAY_API_KEY,
      c.env.CLOUDFLARE_AI_GATEWAY_API_KEY,
      c.env.TELEGRAM_BOT_TOKEN,
      c.env.DISCORD_BOT_TOKEN,
      c.env.SLACK_BOT_TOKEN,
      c.env.SLACK_APP_TOKEN,
      c.env.R2_ACCESS_KEY_ID,
      c.env.R2_SECRET_ACCESS_KEY,
      c.env.FEISHU_APP_ID,
      c.env.FEISHU_APP_SECRET,
      c.env.GDM_API_TOKEN,
      c.env.STORY_TOKEN,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);

    let out = input;
    for (const s of secrets) out = out.split(s).join('[REDACTED]');
    return out;
  }

  function tail(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(text.length - maxChars);
  }

  try {
    // Bound sandbox interactions so the status endpoint never hangs the loading page,
    // even if the sandbox DO is busy with another long-running operation.
    const process = await withTimeout(findExistingMoltbotProcess(sandbox), 2500, 'findExistingMoltbotProcess');
    if (!process) {
      // Kick off a background start so the loading page can self-heal.
      c.executionCtx.waitUntil(
        startMoltbotGateway(sandbox, c.env).catch((err) => {
          console.error('[STATUS] Background start failed:', err);
        }),
      );
      return c.json({ ok: false, status: 'not_running', starting: true });
    }

    const startedAt = process.startTime ? process.startTime.toISOString() : undefined;
    const uptimeMs = process.startTime ? now - process.startTime.getTime() : undefined;

    // Process exists, check if it's actually responding
    // Try to reach the gateway with a short timeout
    try {
      await withTimeout(
        process.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: 500 }),
        1200,
        'process.waitForPort',
      );

      // When authorized, include a small log tail to make remote debugging possible
      // without needing Cloudflare Access (still gated by the gateway token).
      if (allowDetails) {
        try {
          const logs = await withTimeout(process.getLogs(), 2500, 'process.getLogs');
          return c.json({
            ok: true,
            status: 'running',
            processId: process.id,
            startedAt,
            uptimeMs,
            logs: {
              stdout: tail(redactSecrets(logs.stdout || ''), 8000),
              stderr: tail(redactSecrets(logs.stderr || ''), 8000),
            },
          });
        } catch (logErr) {
          return c.json({
            ok: true,
            status: 'running',
            processId: process.id,
            startedAt,
            uptimeMs,
            logs_error: logErr instanceof Error ? logErr.message : 'Failed to retrieve logs',
          });
        }
      }

      return c.json({ ok: true, status: 'running', processId: process.id, startedAt, uptimeMs });
    } catch (err) {
      const base = {
        ok: false,
        status: 'not_responding',
        processId: process.id,
        processStatus: process.status,
        startedAt,
        uptimeMs,
      } as Record<string, unknown>;

      if (allowDetails) {
        try {
          const logs = await withTimeout(process.getLogs(), 2500, 'process.getLogs');
          base.logs = {
            stdout: tail(redactSecrets(logs.stdout || ''), 8000),
            stderr: tail(redactSecrets(logs.stderr || ''), 8000),
          };
        } catch (logErr) {
          base.logs_error = logErr instanceof Error ? logErr.message : 'Failed to retrieve logs';
        }
      } else if (wantDetails) {
        base.details = 'Set ?token=... (gateway token) to view logs';
      }

      // If sandbox calls are timing out, surface that as a "busy" state for better UX.
      if (err instanceof TimeoutError) {
        base.status = 'busy';
      }

      return c.json(base);
    }
  } catch (err) {
    return c.json({
      ok: false,
      status: err instanceof TimeoutError ? 'busy' : 'error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST /api/restart - Token-gated gateway restart (no Cloudflare Access required)
//
// This is intentionally public (to support agent workflows) but requires the gateway token.
// It mirrors /api/admin/gateway/restart, minus the Access JWT requirement.
publicRoutes.post('/api/restart', async (c) => {
  const sandbox = c.get('sandbox');
  const url = new URL(c.req.url);

  const expectedToken = c.env.MOLTBOT_GATEWAY_TOKEN || '';
  const tokenParam = url.searchParams.get('token') || '';
  const auth = c.req.header('Authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : '';
  const providedToken = (tokenParam || bearer).trim();

  if (!expectedToken || !providedToken || providedToken !== expectedToken) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    // Find and kill the existing gateway process.
    // Bound the lookup so we don't hang if the sandbox DO is busy.
    let existingProcess = null;
    try {
      existingProcess = await withTimeout(
        findExistingMoltbotProcess(sandbox),
        2500,
        'findExistingMoltbotProcess',
      );
    } catch (e) {
      if (e instanceof TimeoutError) {
        return c.json({ ok: false, status: 'busy', error: 'sandbox busy' }, 409);
      }
      throw e;
    }

    if (existingProcess) {
      console.log('[RESTART] Killing existing gateway process:', existingProcess.id);
      try {
        await existingProcess.kill();
      } catch (killErr) {
        console.error('[RESTART] Error killing process:', killErr);
      }
      // Give the sandbox a moment to release the port.
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Start a new gateway in the background.
    const bootPromise = ensureMoltbotGateway(sandbox, c.env).catch((err) => {
      console.error('[RESTART] Gateway restart failed:', err);
    });
    c.executionCtx.waitUntil(bootPromise);

    return c.json({
      ok: true,
      status: 'restarting',
      previousProcessId: existingProcess?.id,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

export { publicRoutes };
