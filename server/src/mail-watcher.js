import { createImapClient, getSelectedMailboxSnapshot } from './imap-service.js';

const watchers = new Map();
const INBOX = 'INBOX';
const SNAPSHOT_LIMIT = 20;
const EVENT_SNAPSHOT_MIN_LIMIT = 10;
const IDLE_RESTART_INTERVAL = 25 * 60 * 1000;
const FALLBACK_CHECK_INTERVAL = 10_000;
const WATCHER_CLOSE_GRACE = 10_000;
const RECONNECT_MAX_DELAY = 60_000;

export function subscribeToMailEvents(key, account, listener) {
  let watcher = watchers.get(key);
  if (!watcher) {
    watcher = new MailWatcher(key, account);
    watchers.set(key, watcher);
  }

  watcher.subscribe(listener);
  return () => watcher.unsubscribe(listener);
}

export function stopMailWatcher(key) {
  watchers.get(key)?.stop();
}

export function stopSessionMailWatchers(sessionId) {
  const prefix = `${sessionId}:`;
  for (const [key, watcher] of watchers) {
    if (key.startsWith(prefix)) watcher.stop();
  }
}

class MailWatcher {
  constructor(key, account) {
    this.key = key;
    this.account = account;
    this.subscribers = new Set();
    this.client = null;
    this.snapshot = null;
    this.connecting = false;
    this.stopped = false;
    this.snapshotPending = false;
    this.snapshotPendingLimit = 0;
    this.snapshotReading = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.closeTimer = null;
    this.status = { phase: 'connecting' };
  }

  subscribe(listener) {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.subscribers.add(listener);
    queueMicrotask(() => {
      if (!this.subscribers.has(listener)) return;
      try {
        listener('status', this.status);
      } catch {
        // The request close handler removes disconnected SSE subscribers.
      }
    });
    if (this.snapshot) {
      queueMicrotask(() => {
        if (!this.subscribers.has(listener)) return;
        try {
          listener('snapshot', this.snapshot);
        } catch {
          // The request close handler removes disconnected SSE subscribers.
        }
      });
    }
    if (!this.client && !this.connecting) void this.connect();
  }

  unsubscribe(listener) {
    this.subscribers.delete(listener);
    if (this.subscribers.size || this.stopped || this.closeTimer) return;
    this.closeTimer = setTimeout(() => this.stop(), WATCHER_CLOSE_GRACE);
    this.closeTimer.unref?.();
  }

  async connect() {
    if (this.connecting || this.stopped || !this.subscribers.size) return;
    this.connecting = true;
    this.setStatus('connecting');
    const client = createImapClient(this.account, {
      autoIdleDelay: 1_000,
      maxIdleTime: IDLE_RESTART_INTERVAL,
      missingIdleCommand: 'STATUS',
      socketTimeout: 30 * 60 * 1000,
    });
    this.client = client;

    client.on('error', (error) => {
      this.setStatus('reconnecting', { message: publicErrorMessage(error) });
      if (this.client === client) client.close();
    });
    client.on('close', () => this.handleClose(client));
    client.on('exists', (change) => {
      const addedCount = Math.max(1, Number(change.count) - Number(change.prevCount));
      this.broadcast('mailbox-change', {
        mailbox: change.path || INBOX,
        count: Number(change.count) || 0,
        previousCount: Number(change.prevCount) || 0,
      });
      this.queueSnapshot(
        client,
        Math.min(SNAPSHOT_LIMIT, Math.max(EVENT_SNAPSHOT_MIN_LIMIT, addedCount)),
      );
    });

    try {
      await client.connect();
      if (this.stopped || this.client !== client) return;
      const idleSupported = Boolean(client.capabilities?.has?.('IDLE'));
      client.maxIdleTime = idleSupported ? IDLE_RESTART_INTERVAL : FALLBACK_CHECK_INTERVAL;
      await client.mailboxOpen(INBOX, { readOnly: true });
      if (this.stopped || this.client !== client) return;
      this.reconnectAttempts = 0;
      await this.publishSnapshot(client);
      this.setStatus('connected', {
        mode: idleSupported ? 'idle' : 'status-fallback',
        idleSupported,
        ...(idleSupported ? {} : { checkInterval: FALLBACK_CHECK_INTERVAL }),
      });
    } catch (error) {
      console.error('[mail-watcher] IMAP listener failed:', error);
      this.setStatus('reconnecting', { message: publicErrorMessage(error) });
      if (this.client === client) {
        this.client = null;
        client.close();
        this.scheduleReconnect();
      }
    } finally {
      this.connecting = false;
    }
  }

  handleClose(client) {
    if (this.client !== client) return;
    this.client = null;
    this.connecting = false;
    if (!this.stopped && this.subscribers.size) {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.stopped || !this.subscribers.size || this.reconnectTimer) return;
    const delay = Math.min(2_000 * (2 ** this.reconnectAttempts), RECONNECT_MAX_DELAY);
    this.reconnectAttempts += 1;
    this.setStatus('reconnecting', { retryIn: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  queueSnapshot(client, limit = SNAPSHOT_LIMIT) {
    if (this.client !== client || this.stopped) return;
    this.snapshotPending = true;
    this.snapshotPendingLimit = Math.max(this.snapshotPendingLimit, limit);
    if (!this.snapshotReading) void this.flushSnapshots(client);
  }

  async flushSnapshots(client) {
    this.snapshotReading = true;
    try {
      while (this.snapshotPending && this.client === client && !this.stopped) {
        this.snapshotPending = false;
        const limit = this.snapshotPendingLimit || SNAPSHOT_LIMIT;
        this.snapshotPendingLimit = 0;
        await this.publishSnapshot(client, limit);
      }
    } catch {
      // Connection errors are handled by the close event and reconnect loop.
    } finally {
      this.snapshotReading = false;
    }
  }

  async publishSnapshot(client, limit = SNAPSHOT_LIMIT) {
    const snapshot = await getSelectedMailboxSnapshot(client, INBOX, limit);
    if (this.client !== client || this.stopped) return;
    this.snapshot = snapshot;
    this.broadcast('snapshot', snapshot);
  }

  setStatus(phase, details = {}) {
    this.status = { phase, ...details };
    this.broadcast('status', this.status);
  }

  broadcast(event, payload) {
    for (const listener of this.subscribers) {
      try {
        listener(event, payload);
      } catch {
        // A disconnected SSE subscriber is removed by its request close handler.
      }
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.closeTimer);
    clearTimeout(this.reconnectTimer);
    this.closeTimer = null;
    this.reconnectTimer = null;
    this.subscribers.clear();
    watchers.delete(this.key);

    const client = this.client;
    this.client = null;
    if (!client) return;
    if (client.usable) {
      client.logout().catch(() => client.close());
    } else {
      client.close();
    }
  }
}

function publicErrorMessage(error) {
  if (error?.authenticationFailed) return '邮箱授权已失效';
  if (error?.code === 'ETIMEOUT') return '邮箱服务器连接超时';
  return '邮箱实时连接暂时不可用';
}
