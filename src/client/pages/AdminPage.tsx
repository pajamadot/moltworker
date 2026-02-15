import { useState, useEffect, useCallback } from 'react';
import {
  listDevices,
  approveDevice,
  approveAllDevices,
  listPairingRequests,
  approvePairingCode,
  restartGateway,
  getStorageStatus,
  triggerSync,
  AuthError,
  type PendingDevice,
  type PairedDevice,
  type DeviceListResponse,
  type StorageStatusResponse,
  type PairingListResponse,
} from '../api';
import './AdminPage.css';

// Small inline spinner for buttons
function ButtonSpinner() {
  return <span className="btn-spinner" />;
}

function formatSyncTime(isoString: string | null) {
  if (!isoString) return 'Never';
  try {
    const date = new Date(isoString);
    return date.toLocaleString();
  } catch {
    return isoString;
  }
}

function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleString();
}

function formatTimeAgo(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminPage() {
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [paired, setPaired] = useState<PairedDevice[]>([]);
  const [storageStatus, setStorageStatus] = useState<StorageStatusResponse | null>(null);
  const [discordPairing, setDiscordPairing] = useState<PairingListResponse | null>(null);
  const [feishuPairing, setFeishuPairing] = useState<PairingListResponse | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingApproveLoading, setPairingApproveLoading] = useState(false);
  const [feishuPairingCode, setFeishuPairingCode] = useState('');
  const [feishuPairingLoading, setFeishuPairingLoading] = useState(false);
  const [feishuPairingApproveLoading, setFeishuPairingApproveLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [restartInProgress, setRestartInProgress] = useState(false);
  const [syncInProgress, setSyncInProgress] = useState(false);

  const fetchDevices = useCallback(async () => {
    try {
      setError(null);
      const data: DeviceListResponse = await listDevices();
      setPending(data.pending || []);
      setPaired(data.paired || []);

      if (data.error) {
        setError(data.error);
      } else if (data.parseError) {
        setError(`Parse error: ${data.parseError}`);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        setError('Authentication required. Please log in via Cloudflare Access.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch devices');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStorageStatus = useCallback(async () => {
    try {
      const status = await getStorageStatus();
      setStorageStatus(status);
    } catch (err) {
      // Don't show error for storage status - it's not critical
      console.error('Failed to fetch storage status:', err);
    }
  }, []);

  const fetchDiscordPairing = useCallback(async () => {
    setPairingLoading(true);
    try {
      const data = await listPairingRequests('discord');
      setDiscordPairing(data);
    } catch (err) {
      console.error('Failed to fetch pairing requests:', err);
      // Keep pairing errors separate from the main banner; show them inline.
      setDiscordPairing({
        channel: 'discord',
        requests: [],
        error: err instanceof Error ? err.message : 'Failed to fetch pairing requests',
      });
    } finally {
      setPairingLoading(false);
    }
  }, []);

  const fetchFeishuPairing = useCallback(async () => {
    setFeishuPairingLoading(true);
    try {
      const data = await listPairingRequests('feishu');
      setFeishuPairing(data);
    } catch (err) {
      console.error('Failed to fetch pairing requests:', err);
      setFeishuPairing({
        channel: 'feishu',
        requests: [],
        error: err instanceof Error ? err.message : 'Failed to fetch pairing requests',
      });
    } finally {
      setFeishuPairingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    fetchStorageStatus();
    fetchDiscordPairing();
    fetchFeishuPairing();
  }, [fetchDevices, fetchStorageStatus, fetchDiscordPairing, fetchFeishuPairing]);

  const handleApprove = async (requestId: string) => {
    setActionInProgress(requestId);
    try {
      const result = await approveDevice(requestId);
      if (result.success) {
        // Refresh the list
        await fetchDevices();
      } else {
        setError(result.error || 'Approval failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve device');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleApproveAll = async () => {
    if (pending.length === 0) return;

    setActionInProgress('all');
    try {
      const result = await approveAllDevices();
      if (result.failed && result.failed.length > 0) {
        setError(`Failed to approve ${result.failed.length} device(s)`);
      }
      // Refresh the list
      await fetchDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve devices');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestartGateway = async () => {
    if (
      !confirm(
        'Are you sure you want to restart the gateway? This will disconnect all clients temporarily.',
      )
    ) {
      return;
    }

    setRestartInProgress(true);
    try {
      const result = await restartGateway();
      if (result.success) {
        setError(null);
        // Show success message briefly
        alert('Gateway restart initiated. Clients will reconnect automatically.');
      } else {
        setError(result.error || 'Failed to restart gateway');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart gateway');
    } finally {
      setRestartInProgress(false);
    }
  };

  const handleSync = async () => {
    setSyncInProgress(true);
    try {
      const result = await triggerSync();
      if (result.success) {
        // Update the storage status with new lastSync time
        setStorageStatus((prev) => (prev ? { ...prev, lastSync: result.lastSync || null } : null));
        setError(null);
      } else {
        setError(result.error || 'Sync failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync');
    } finally {
      setSyncInProgress(false);
    }
  };

  const handleApproveDiscordPairing = async () => {
    const code = pairingCode.trim();
    if (!code) return;

    setPairingApproveLoading(true);
    try {
      const result = await approvePairingCode('discord', code, true);
      if (!result.success) {
        setDiscordPairing((prev) => (prev ? { ...prev, error: result.error || result.message } : prev));
      } else {
        setPairingCode('');
        await fetchDiscordPairing();
      }
    } catch (err) {
      setDiscordPairing((prev) => (prev ? { ...prev, error: err instanceof Error ? err.message : 'Approval failed' } : prev));
    } finally {
      setPairingApproveLoading(false);
    }
  };

  const handleApproveFeishuPairing = async () => {
    const code = feishuPairingCode.trim();
    if (!code) return;

    setFeishuPairingApproveLoading(true);
    try {
      const result = await approvePairingCode('feishu', code, true);
      if (!result.success) {
        setFeishuPairing((prev) =>
          prev ? { ...prev, error: result.error || result.message } : prev,
        );
      } else {
        setFeishuPairingCode('');
        await fetchFeishuPairing();
      }
    } catch (err) {
      setFeishuPairing((prev) =>
        prev ? { ...prev, error: err instanceof Error ? err.message : 'Approval failed' } : prev,
      );
    } finally {
      setFeishuPairingApproveLoading(false);
    }
  };

  return (
    <div className="devices-page">
      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="dismiss-btn">
            Dismiss
          </button>
        </div>
      )}

      {storageStatus && !storageStatus.configured && (
        <div className="warning-banner">
          <div className="warning-content">
            <strong>R2 Storage Not Configured</strong>
            <p>
              Paired devices and conversations will be lost when the container restarts. To enable
              persistent storage, configure R2 credentials. See the{' '}
              <a
                href="https://github.com/cloudflare/moltworker"
                target="_blank"
                rel="noopener noreferrer"
              >
                README
              </a>{' '}
              for setup instructions.
            </p>
            {storageStatus.missing && (
              <p className="missing-secrets">Missing: {storageStatus.missing.join(', ')}</p>
            )}
          </div>
        </div>
      )}

      {storageStatus?.configured && (
        <div className="success-banner">
          <div className="storage-status">
            <div className="storage-info">
              <span>
                R2 storage is configured. Your data will persist across container restarts.
              </span>
              <span className="last-sync">
                Last backup: {formatSyncTime(storageStatus.lastSync)}
              </span>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleSync}
              disabled={syncInProgress}
            >
              {syncInProgress && <ButtonSpinner />}
              {syncInProgress ? 'Syncing...' : 'Backup Now'}
            </button>
          </div>
        </div>
      )}

      <section className="devices-section gateway-section">
        <div className="section-header">
          <h2>Gateway Controls</h2>
          <button
            className="btn btn-danger"
            onClick={handleRestartGateway}
            disabled={restartInProgress}
          >
            {restartInProgress && <ButtonSpinner />}
            {restartInProgress ? 'Restarting...' : 'Restart Gateway'}
          </button>
        </div>
        <p className="hint">
          Restart the gateway to apply configuration changes or recover from errors. All connected
          clients will be temporarily disconnected.
        </p>
      </section>

      <section className="devices-section pairing-section">
        <div className="section-header">
          <h2>Discord DM Pairing</h2>
          <button
            className="btn btn-secondary"
            onClick={fetchDiscordPairing}
            disabled={pairingLoading}
          >
            {pairingLoading && <ButtonSpinner />}
            {pairingLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <p className="hint">
          If you set <code>DISCORD_DM_POLICY=pairing</code>, Discord DMs require a pairing code. DM the bot, copy the code it replies with, then approve it here.
          If you want to skip pairing (less secure), set <code>DISCORD_DM_POLICY=open</code> and restart the gateway.
        </p>

        <div className="pairing-controls">
          <input
            className="pairing-code-input"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
            placeholder="Pairing code (e.g. ABC123)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleApproveDiscordPairing();
            }}
          />
          <button
            className="btn btn-success"
            onClick={() => void handleApproveDiscordPairing()}
            disabled={pairingApproveLoading || pairingCode.trim() === ''}
          >
            {pairingApproveLoading && <ButtonSpinner />}
            {pairingApproveLoading ? 'Approving...' : 'Approve'}
          </button>
        </div>

        {discordPairing?.error && (
          <div className="error-banner">
            <span>{discordPairing.error}</span>
            <button onClick={() => setDiscordPairing(null)} className="dismiss-btn">
              Dismiss
            </button>
          </div>
        )}

      {discordPairing && (
          <div className="pairing-requests">
            <div className="pairing-meta">
              <span>Pending requests: {discordPairing.requests?.length ?? 0}</span>
            </div>
            {Array.isArray(discordPairing.requests) && discordPairing.requests.length > 0 && (
              <pre className="pairing-pre">{JSON.stringify(discordPairing.requests, null, 2)}</pre>
            )}
          </div>
        )}
      </section>

      <section className="devices-section pairing-section">
        <div className="section-header">
          <h2>Feishu/Lark DM Pairing</h2>
          <button
            className="btn btn-secondary"
            onClick={fetchFeishuPairing}
            disabled={feishuPairingLoading}
          >
            {feishuPairingLoading && <ButtonSpinner />}
            {feishuPairingLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <p className="hint">
          If you set <code>FEISHU_DM_POLICY=pairing</code>, Feishu DMs require a pairing code. DM the bot, copy the code it replies with, then approve it here.
          If you want to skip pairing (less secure), set <code>FEISHU_DM_POLICY=open</code> and restart the gateway.
        </p>

        <div className="pairing-controls">
          <input
            className="pairing-code-input"
            value={feishuPairingCode}
            onChange={(e) => setFeishuPairingCode(e.target.value)}
            placeholder="Pairing code (e.g. ABC123)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleApproveFeishuPairing();
            }}
          />
          <button
            className="btn btn-success"
            onClick={() => void handleApproveFeishuPairing()}
            disabled={feishuPairingApproveLoading || feishuPairingCode.trim() === ''}
          >
            {feishuPairingApproveLoading && <ButtonSpinner />}
            {feishuPairingApproveLoading ? 'Approving...' : 'Approve'}
          </button>
        </div>

        {feishuPairing?.error && (
          <div className="error-banner">
            <span>{feishuPairing.error}</span>
            <button onClick={() => setFeishuPairing(null)} className="dismiss-btn">
              Dismiss
            </button>
          </div>
        )}

        {feishuPairing && (
          <div className="pairing-requests">
            <div className="pairing-meta">
              <span>Pending requests: {feishuPairing.requests?.length ?? 0}</span>
            </div>
            {Array.isArray(feishuPairing.requests) && feishuPairing.requests.length > 0 && (
              <pre className="pairing-pre">{JSON.stringify(feishuPairing.requests, null, 2)}</pre>
            )}
          </div>
        )}
      </section>

      {loading ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading devices...</p>
        </div>
      ) : (
        <>
          <section className="devices-section">
            <div className="section-header">
              <h2>Pending Pairing Requests</h2>
              <div className="header-actions">
                {pending.length > 0 && (
                  <button
                    className="btn btn-primary"
                    onClick={handleApproveAll}
                    disabled={actionInProgress !== null}
                  >
                    {actionInProgress === 'all' && <ButtonSpinner />}
                    {actionInProgress === 'all'
                      ? 'Approving...'
                      : `Approve All (${pending.length})`}
                  </button>
                )}
                <button className="btn btn-secondary" onClick={fetchDevices} disabled={loading}>
                  Refresh
                </button>
              </div>
            </div>
            <p className="hint">
              After approving a device, refresh the Control UI tab at{' '}
              <a href="/" target="_blank" rel="noreferrer">
                /
              </a>
              .
            </p>

            {pending.length === 0 ? (
              <div className="empty-state">
                <p>No pending pairing requests</p>
                <p className="hint">
                  Devices will appear here when they attempt to connect without being paired.
                </p>
              </div>
            ) : (
              <div className="devices-grid">
                {pending.map((device) => (
                  <div key={device.requestId} className="device-card pending">
                    <div className="device-header">
                      <span className="device-name">
                        {device.displayName || device.deviceId || 'Unknown Device'}
                      </span>
                      <span className="device-badge pending">Pending</span>
                    </div>
                    <div className="device-details">
                      {device.platform && (
                        <div className="detail-row">
                          <span className="label">Platform:</span>
                          <span className="value">{device.platform}</span>
                        </div>
                      )}
                      {device.clientId && (
                        <div className="detail-row">
                          <span className="label">Client:</span>
                          <span className="value">{device.clientId}</span>
                        </div>
                      )}
                      {device.clientMode && (
                        <div className="detail-row">
                          <span className="label">Mode:</span>
                          <span className="value">{device.clientMode}</span>
                        </div>
                      )}
                      {device.role && (
                        <div className="detail-row">
                          <span className="label">Role:</span>
                          <span className="value">{device.role}</span>
                        </div>
                      )}
                      {device.remoteIp && (
                        <div className="detail-row">
                          <span className="label">IP:</span>
                          <span className="value">{device.remoteIp}</span>
                        </div>
                      )}
                      <div className="detail-row">
                        <span className="label">Requested:</span>
                        <span className="value" title={formatTimestamp(device.ts)}>
                          {formatTimeAgo(device.ts)}
                        </span>
                      </div>
                    </div>
                    <div className="device-actions">
                      <button
                        className="btn btn-success"
                        onClick={() => handleApprove(device.requestId)}
                        disabled={actionInProgress !== null}
                      >
                        {actionInProgress === device.requestId && <ButtonSpinner />}
                        {actionInProgress === device.requestId ? 'Approving...' : 'Approve'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="devices-section">
            <div className="section-header">
              <h2>Paired Devices</h2>
            </div>

            {paired.length === 0 ? (
              <div className="empty-state">
                <p>No paired devices</p>
              </div>
            ) : (
              <div className="devices-grid">
                {paired.map((device) => (
                  <div key={device.deviceId} className="device-card paired">
                    <div className="device-header">
                      <span className="device-name">
                        {device.displayName || device.deviceId || 'Unknown Device'}
                      </span>
                      <span className="device-badge paired">Paired</span>
                    </div>
                    <div className="device-details">
                      {device.platform && (
                        <div className="detail-row">
                          <span className="label">Platform:</span>
                          <span className="value">{device.platform}</span>
                        </div>
                      )}
                      {device.clientId && (
                        <div className="detail-row">
                          <span className="label">Client:</span>
                          <span className="value">{device.clientId}</span>
                        </div>
                      )}
                      {device.clientMode && (
                        <div className="detail-row">
                          <span className="label">Mode:</span>
                          <span className="value">{device.clientMode}</span>
                        </div>
                      )}
                      {device.role && (
                        <div className="detail-row">
                          <span className="label">Role:</span>
                          <span className="value">{device.role}</span>
                        </div>
                      )}
                      <div className="detail-row">
                        <span className="label">Paired:</span>
                        <span className="value" title={formatTimestamp(device.approvedAtMs)}>
                          {formatTimeAgo(device.approvedAtMs)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
