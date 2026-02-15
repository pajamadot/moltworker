import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { MOLTBOT_PORT, STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars } from './env';
import { TimeoutError, withTimeout } from '../utils/timeout';

/**
 * Find an existing OpenClaw gateway process
 *
 * @param sandbox - The sandbox instance
 * @returns The process if found and running/starting, null otherwise
 */
export async function findExistingMoltbotProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await withTimeout(sandbox.listProcesses(), 2000, 'sandbox.listProcesses');
    for (const proc of processes) {
      // Match gateway process (openclaw gateway or legacy clawdbot gateway)
      // Don't match CLI commands like "openclaw devices list"
      const isGatewayProcess =
        proc.command.includes('start-openclaw.sh') ||
        proc.command.includes('openclaw gateway') ||
        // Legacy: match old startup script during transition
        proc.command.includes('start-moltbot.sh') ||
        proc.command.includes('clawdbot gateway');
      const isCliCommand =
        proc.command.includes('openclaw devices') ||
        proc.command.includes('openclaw --version') ||
        proc.command.includes('openclaw onboard') ||
        proc.command.includes('clawdbot devices') ||
        proc.command.includes('clawdbot --version');

      if (isGatewayProcess && !isCliCommand) {
        if (proc.status === 'starting' || proc.status === 'running') {
          return proc;
        }
      }
    }
  } catch (e) {
    // Surface timeouts to callers so they can treat the sandbox as "busy" rather than "not running".
    if (e instanceof TimeoutError) throw e;
    console.log('Could not list processes:', e);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start the OpenClaw gateway process if it isn't already running.
 *
 * This is intentionally NON-BLOCKING: it does not wait for the gateway port to open.
 * Use ensureMoltbotGateway() when you need to wait for readiness.
 */
export async function startMoltbotGateway(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  let existingProcess: Process | null = null;
  try {
    existingProcess = await findExistingMoltbotProcess(sandbox);
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.log('[Gateway] listProcesses timed out; proceeding to start gateway anyway');
    } else {
      throw e;
    }
  }
  if (existingProcess) {
    console.log(
      'Found existing gateway process:',
      existingProcess.id,
      'status:',
      existingProcess.status,
    );
    return existingProcess;
  }

  console.log('Starting new OpenClaw gateway (non-blocking)...');
  const envVars = buildEnvVars(env);
  const command = '/usr/local/bin/start-openclaw.sh';

  console.log('Starting process with command:', command);
  console.log('Environment vars being passed:', Object.keys(envVars));

  const process = await sandbox.startProcess(command, {
    env: Object.keys(envVars).length > 0 ? envVars : undefined,
  });
  console.log('Process started with id:', process.id, 'status:', process.status);
  return process;
}

/**
 * Ensure the OpenClaw gateway is running
 *
 * This will:
 * 1. Mount R2 storage if configured
 * 2. Check for an existing gateway process
 * 3. Wait for it to be ready, or start a new one
 *
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns The running gateway process
 */
export async function ensureMoltbotGateway(sandbox: Sandbox, env: MoltbotEnv): Promise<Process> {
  let process = await startMoltbotGateway(sandbox, env);

  // IMPORTANT: Sandbox is a Durable Object. Long-running calls like waitForPort(180s)
  // can block other sandbox operations (e.g. /api/status). Poll with short timeouts
  // and yield between attempts so other requests can be served.
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  const pollTimeoutMs = 1000;

  while (Date.now() < deadline) {
    try {
      await process.waitForPort(MOLTBOT_PORT, { mode: 'tcp', timeout: pollTimeoutMs });
      console.log('[Gateway] OpenClaw gateway is ready!');
      return process;
    } catch {
      // Not ready yet.
    }
    // Yield so other requests to the sandbox DO can run.
    // eslint-disable-next-line no-await-in-loop -- intentional polling
    await sleep(750);

    // Process may have exited; refresh handle if needed.
    // eslint-disable-next-line no-await-in-loop -- intentional polling
    let existing: Process | null = null;
    try {
      existing = await findExistingMoltbotProcess(sandbox);
    } catch (e) {
      if (e instanceof TimeoutError) {
        // Sandbox is busy (likely still starting). Keep waiting.
        continue;
      }
      throw e;
    }
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop -- start is idempotent
      process = await startMoltbotGateway(sandbox, env);
    } else {
      process = existing;
    }
  }

  console.error('[Gateway] Gateway did not become ready before timeout, killing process...');
  try {
    await process.kill();
  } catch (killError) {
    console.error('[Gateway] Failed to kill process:', killError);
  }

  try {
    const logs = await process.getLogs();
    throw new Error(`OpenClaw gateway failed to start. Stderr: ${logs.stderr || '(empty)'}`);
  } catch (logErr) {
    console.error('[Gateway] Failed to get logs:', logErr);
    throw new Error('OpenClaw gateway failed to start (no logs available)');
  }
}
