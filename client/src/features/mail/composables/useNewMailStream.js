import { onBeforeUnmount } from 'vue';
import { api } from '@/shared/api/xmail-api.js';
import { notify } from '@/shared/ui/toast/toast-store.js';

export function useNewMailStream(account, state, { onNewMail, onSessionExpired }) {
  let inboxSnapshot = null;
  let mailEvents = null;
  let snapshotQueue = Promise.resolve();
  let connectionWarningShown = false;
  let fallbackSnapshotTimer = null;

  onBeforeUnmount(stop);

  async function initialize(inboxPath) {
    try {
      const snapshot = await api.mailboxSnapshot(account.id, inboxPath);
      inboxSnapshot = snapshotIdentity(snapshot);
    } catch (error) {
      if (error.status === 401) throw error;
    }
    start();
  }

  function start() {
    if (mailEvents || typeof EventSource === 'undefined') return;
    mailEvents = new EventSource(api.mailEventsUrl(account.id));
    mailEvents.addEventListener('status', (event) => {
      const status = parseEventData(event);
      if (!status) return;
      if (status.phase === 'connected') {
        connectionWarningShown = false;
        return;
      }
      if (status.phase === 'reconnecting') {
        warnConnection(status.message || '新邮件实时连接中断，正在自动重连');
      }
    });
    mailEvents.addEventListener('mailbox-change', () => {
      clearTimeout(fallbackSnapshotTimer);
      fallbackSnapshotTimer = setTimeout(() => {
        fallbackSnapshotTimer = null;
        enqueueSnapshot(syncMailboxSnapshot);
      }, 2_000);
    });
    mailEvents.addEventListener('snapshot', (event) => {
      const snapshot = parseEventData(event);
      if (!snapshot) return;
      clearTimeout(fallbackSnapshotTimer);
      fallbackSnapshotTimer = null;
      enqueueSnapshot(() => handleSnapshot(snapshot));
    });
    mailEvents.onerror = () => {
      warnConnection('新邮件事件连接中断，正在自动重连');
    };
  }

  function stop() {
    clearTimeout(fallbackSnapshotTimer);
    fallbackSnapshotTimer = null;
    mailEvents?.close();
    mailEvents = null;
  }

  function enqueueSnapshot(task) {
    snapshotQueue = snapshotQueue.then(task).catch((error) => {
      if (error?.status === 401) onSessionExpired();
    });
  }

  async function syncMailboxSnapshot() {
    const inbox = state.mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Inbox');
    if (!inbox) return;
    const snapshot = await api.mailboxSnapshot(account.id, inbox.path);
    await handleSnapshot(snapshot);
  }

  function warnConnection(message) {
    if (connectionWarningShown) return;
    connectionWarningShown = true;
    notify(message, 'error');
  }

  async function handleSnapshot(snapshot) {
    const inbox = state.mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Inbox');
    if (!inbox) return;

    try {
      const nextIdentity = snapshotIdentity(snapshot);
      if (!inboxSnapshot || inboxSnapshot.uidValidity !== nextIdentity.uidValidity) {
        inboxSnapshot = nextIdentity;
        return;
      }

      const newMessages = snapshot.messages
        .filter((message) => Number(message.uid) > inboxSnapshot.latestUid)
        .sort((a, b) => Number(a.uid) - Number(b.uid));
      inboxSnapshot = {
        ...nextIdentity,
        latestUid: Math.max(inboxSnapshot.latestUid, nextIdentity.latestUid),
      };
      if (!newMessages.length) return;

      onNewMail({
        account,
        messages: newMessages,
        inboxVisible: state.activeMailbox.value === inbox.path
          && !state.query.value.trim()
          && !state.activeGroup.value,
      });
      const refreshes = [api.mailboxes(account.id).then((result) => {
        state.mailboxes.value = result.mailboxes;
      })];
      if (
        state.activeMailbox.value === inbox.path
        && !state.query.value.trim()
        && !state.activeGroup.value
        && !state.listLoading.value
        && !state.backgroundRefreshing.value
      ) {
        refreshes.push(state.loadFirstPage({ silent: true }));
      }
      await Promise.all(refreshes);
    } catch (error) {
      if (error.status === 401) onSessionExpired();
    }
  }

  return { initialize, stop };
}

function parseEventData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function snapshotIdentity(snapshot) {
  return {
    uidValidity: String(snapshot.uidValidity || ''),
    latestUid: snapshot.messages.reduce(
      (latest, message) => Math.max(latest, Number(message.uid) || 0),
      0,
    ),
  };
}
