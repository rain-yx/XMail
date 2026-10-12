import { ref } from 'vue';
import { api } from '@/shared/api/xmail-api.js';
import { notify } from '@/shared/ui/toast/toast-store.js';

export function useMessageActions(account, state, handleRequestError) {
  const detailLoading = ref(false);

  async function openMessage(summary) {
    state.activeMessage.value = { ...summary };
    detailLoading.value = true;
    try {
      const result = await api.message(account.id, state.activeMailbox.value, summary.uid);
      state.activeMessage.value = result.message;
      if (!summary.seen) {
        summary.seen = true;
        const folder = state.mailboxes.value.find((item) => item.path === state.activeMailbox.value);
        if (folder?.unseen) folder.unseen -= 1;
      }
    } catch (error) {
      state.activeMessage.value = null;
      handleRequestError(error);
    } finally {
      detailLoading.value = false;
    }
  }

  async function toggleStar(message) {
    const nextValue = !message.flagged;
    const listMessage = state.messages.value.find((item) => item.uid === message.uid);
    message.flagged = nextValue;
    if (listMessage) listMessage.flagged = nextValue;
    try {
      await api.updateFlags(account.id, state.activeMailbox.value, [message.uid], { flagged: nextValue });
    } catch (error) {
      message.flagged = !nextValue;
      if (listMessage) listMessage.flagged = !nextValue;
      handleRequestError(error);
    }
  }

  async function setMessageSeen(message, seen) {
    if (message.seen === seen) return;
    const previous = message.seen;
    const folder = state.mailboxes.value.find((item) => item.path === state.activeMailbox.value);
    const previousUnseen = folder?.unseen;
    message.seen = seen;
    if (state.activeMessage.value?.uid === message.uid) state.activeMessage.value.seen = seen;
    if (folder) folder.unseen = Math.max(0, (folder.unseen || 0) + (seen ? -1 : 1));

    try {
      await api.updateFlags(account.id, state.activeMailbox.value, [message.uid], { seen });
      notify(seen ? '已标为已读' : '已标为未读');
    } catch (error) {
      message.seen = previous;
      if (state.activeMessage.value?.uid === message.uid) state.activeMessage.value.seen = previous;
      if (folder && previousUnseen !== undefined) folder.unseen = previousUnseen;
      handleRequestError(error);
    }
  }

  function toggleSelect(uid) {
    const next = new Set(state.selected.value);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    state.selected.value = next;
  }

  function toggleAll() {
    const selectable = state.messages.value.filter((message) => message.kind !== 'group');
    state.selected.value = state.selected.value.size === selectable.length
      ? new Set()
      : new Set(selectable.map((message) => message.uid));
  }

  async function markSelected(seen) {
    const uids = [...state.selected.value];
    if (!uids.length) return;
    try {
      await api.updateFlags(account.id, state.activeMailbox.value, uids, { seen });
      for (const message of state.messages.value) {
        if (state.selected.value.has(message.uid)) message.seen = seen;
      }
      state.selected.value = new Set();
      notify(seen ? '已标为已读' : '已标为未读');
      state.mailboxes.value = (await api.mailboxes(account.id)).mailboxes;
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function deleteSelected() {
    const uids = [...state.selected.value];
    if (!uids.length || !state.trashFolder.value) return;
    try {
      await api.move(account.id, state.activeMailbox.value, uids, state.trashFolder.value.path);
      notify(`已将 ${uids.length} 封邮件移至已删除`);
      await state.refreshAll();
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function deleteMessage(message) {
    if (
      !message?.uid
      || !state.trashFolder.value
      || state.trashFolder.value.path === state.activeMailbox.value
    ) return;
    try {
      await api.move(
        account.id,
        state.activeMailbox.value,
        [message.uid],
        state.trashFolder.value.path,
      );
      notify('邮件已移至已删除');
      await state.refreshAll();
    } catch (error) {
      handleRequestError(error);
    }
  }

  return {
    detailLoading,
    openMessage,
    toggleStar,
    setMessageSeen,
    toggleSelect,
    toggleAll,
    markSelected,
    deleteSelected,
    deleteMessage,
  };
}
