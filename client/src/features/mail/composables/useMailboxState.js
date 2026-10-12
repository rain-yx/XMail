import { computed, ref } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { api } from '@/shared/api/xmail-api.js';
import { notify } from '@/shared/ui/toast/toast-store.js';
import { matchesMessageSummary } from '../lib/message-search.js';
import { messageIdentity, sortMessagesNewestFirst } from '../lib/message-utils.js';

const PAGE_SIZE = 40;

export function useMailboxState(account, handleRequestError) {
  const mailboxes = ref([]);
  const activeMailbox = ref('INBOX');
  const messages = ref([]);
  const unfilteredMessages = ref([]);
  const total = ref(0);
  const page = ref(0);
  const query = ref('');
  const listLoading = ref(false);
  const loadingMore = ref(false);
  const backgroundRefreshing = ref(false);
  const activeMessage = ref(null);
  const selected = ref(new Set());
  const activeGroup = ref(null);
  const trashFolder = computed(() => (
    mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Trash')
  ));
  const hasMore = computed(() => messages.value.length < total.value);
  let listRequestId = 0;

  async function initializeFolders() {
    const result = await api.mailboxes(account.id);
    mailboxes.value = result.mailboxes;
    const inbox = mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Inbox');
    activeMailbox.value = inbox?.path || 'INBOX';
    return activeMailbox.value;
  }

  async function loadFirstPage({ silent = false } = {}) {
    const requestId = ++listRequestId;
    const requestedQuery = query.value.trim();
    if (silent) {
      backgroundRefreshing.value = true;
    } else {
      backgroundRefreshing.value = false;
      listLoading.value = true;
      selected.value = new Set();
      page.value = 0;
    }
    try {
      const result = await api.messages(account.id, {
        mailbox: activeMailbox.value,
        page: 1,
        pageSize: PAGE_SIZE,
        query: requestedQuery,
        groupId: activeGroup.value?.ruleId || '',
      });
      if (requestId !== listRequestId) return;
      let nextMessages = sortMessagesNewestFirst(result.messages);
      let nextTotal = result.total;
      if (requestedQuery && !activeGroup.value && !nextMessages.length) {
        nextMessages = unfilteredMessages.value.filter((message) => (
          matchesMessageSummary(message, requestedQuery)
        ));
        nextTotal = nextMessages.length;
      } else if (!requestedQuery && !activeGroup.value) {
        unfilteredMessages.value = nextMessages;
      }
      messages.value = nextMessages;
      total.value = nextTotal;
      page.value = 1;
    } catch (error) {
      if (requestId === listRequestId) {
        const localMatches = requestedQuery
          ? unfilteredMessages.value.filter((message) => matchesMessageSummary(message, requestedQuery))
          : [];
        if (localMatches.length) {
          messages.value = localMatches;
          total.value = localMatches.length;
          page.value = 1;
        } else {
          handleRequestError(error);
        }
      }
    } finally {
      if (requestId === listRequestId) {
        listLoading.value = false;
        backgroundRefreshing.value = false;
      }
    }
  }

  async function loadMore() {
    if (listLoading.value || backgroundRefreshing.value || loadingMore.value || !hasMore.value) return;
    const requestId = listRequestId;
    loadingMore.value = true;
    const nextPage = page.value + 1;
    const requestedQuery = query.value.trim();
    try {
      const result = await api.messages(account.id, {
        mailbox: activeMailbox.value,
        page: nextPage,
        pageSize: PAGE_SIZE,
        query: requestedQuery,
        groupId: activeGroup.value?.ruleId || '',
      });
      if (requestId !== listRequestId) return;
      const known = new Set(messages.value.map(messageIdentity));
      const incoming = result.messages.filter((message) => !known.has(messageIdentity(message)));
      messages.value = sortMessagesNewestFirst([...messages.value, ...incoming]);
      if (!requestedQuery && !activeGroup.value) unfilteredMessages.value = messages.value;
      total.value = result.total;
      page.value = nextPage;
    } catch (error) {
      if (requestId === listRequestId) handleRequestError(error);
    } finally {
      if (requestId === listRequestId) loadingMore.value = false;
    }
  }

  async function refreshAll() {
    try {
      const [folders] = await Promise.all([api.mailboxes(account.id), loadFirstPage()]);
      mailboxes.value = folders.mailboxes;
      notify('邮件已刷新');
    } catch (error) {
      handleRequestError(error);
    }
  }

  function selectMailbox(path) {
    if (path === activeMailbox.value && !activeGroup.value) return;
    activeMailbox.value = path;
    resetView();
    loadFirstPage();
  }

  function showInbox() {
    const inbox = mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Inbox');
    if (!inbox) return;
    activeMailbox.value = inbox.path;
    resetView();
    loadFirstPage();
  }

  function resetView() {
    activeGroup.value = null;
    query.value = '';
    unfilteredMessages.value = [];
    activeMessage.value = null;
  }

  function clearSearch() {
    query.value = '';
    loadFirstPage();
  }

  function openGroup(group) {
    activeGroup.value = {
      ruleId: group.ruleId,
      label: group.label,
      type: group.groupType,
    };
    query.value = '';
    unfilteredMessages.value = [];
    activeMessage.value = null;
    loadFirstPage();
  }

  function leaveGroup() {
    if (!activeGroup.value) return;
    activeGroup.value = null;
    query.value = '';
    unfilteredMessages.value = [];
    activeMessage.value = null;
    loadFirstPage();
  }

  return {
    mailboxes,
    activeMailbox,
    messages,
    unfilteredMessages,
    total,
    query,
    listLoading,
    loadingMore,
    backgroundRefreshing,
    activeMessage,
    selected,
    activeGroup,
    trashFolder,
    hasMore,
    initializeFolders,
    loadFirstPage,
    loadMore,
    refreshAll,
    selectMailbox,
    showInbox,
    clearSearch,
    openGroup,
    leaveGroup,
    searchMessages: useDebounceFn(loadFirstPage, 450),
  };
}
