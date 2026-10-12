<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDebounceFn, useMediaQuery } from '@vueuse/core';
import { AtSign, CaseSensitive, PanelLeft, Search, X } from 'lucide-vue-next';
import { api } from '../api.js';
import { matchesMessageSummary } from '../message-search.js';
import { notify } from '../toast.js';
import MailSidebar from './MailSidebar.vue';
import MessageDetail from './MessageDetail.vue';
import MessageList from './MessageList.vue';

const props = defineProps({ account: { type: Object, required: true } });
const emit = defineEmits(['disconnect', 'session-expired']);

const mailboxes = ref([]);
const activeMailbox = ref('INBOX');
const messages = ref([]);
const unfilteredMessages = ref([]);
const total = ref(0);
const page = ref(0);
const pageSize = 40;
const query = ref('');
const listLoading = ref(false);
const loadingMore = ref(false);
const backgroundRefreshing = ref(false);
const detailLoading = ref(false);
const activeMessage = ref(null);
const selected = ref(new Set());
const confirmOpen = ref(false);
const aggregationTarget = ref(null);
const aggregationBusy = ref(false);
const activeGroup = ref(null);
const sidebarOpen = ref(false);
const isSmallScreen = useMediaQuery('(max-width: 760px)');
let listRequestId = 0;

const trashFolder = computed(() => mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Trash'));
const hasMore = computed(() => messages.value.length < total.value);

onMounted(initializeMailbox);
onMounted(() => window.addEventListener('keydown', handleGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalKeydown));
watch(isSmallScreen, (small) => {
  if (!small) sidebarOpen.value = false;
});

function handleGlobalKeydown(event) {
  if (event.key !== 'Escape') return;
  sidebarOpen.value = false;
  confirmOpen.value = false;
  aggregationTarget.value = null;
}

async function initializeMailbox() {
  try {
    const [result] = await Promise.all([
      api.mailboxes(props.account.id),
      loadFirstPage(),
    ]);
    mailboxes.value = result.mailboxes;
    const inbox = mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Inbox');
    activeMailbox.value = inbox?.path || 'INBOX';
  } catch (error) {
    handleRequestError(error);
  }
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
    const result = await api.messages(props.account.id, {
      mailbox: activeMailbox.value,
      page: 1,
      pageSize,
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
    const result = await api.messages(props.account.id, {
      mailbox: activeMailbox.value,
      page: nextPage,
      pageSize,
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

function sortMessagesNewestFirst(items) {
  return [...items].sort((a, b) => {
    const aGrouped = a.kind === 'group';
    const bGrouped = b.kind === 'group';
    if (aGrouped !== bGrouped) return aGrouped ? -1 : 1;
    const aTime = Date.parse(a.date);
    const bTime = Date.parse(b.date);
    const safeATime = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY;
    const safeBTime = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY;
    if (safeATime !== safeBTime) return safeBTime > safeATime ? 1 : -1;
    return (Number(b.uid || b.latestUid) || 0) - (Number(a.uid || a.latestUid) || 0);
  });
}

function messageIdentity(message) {
  return message.kind === 'group' ? `group:${message.groupId}` : `message:${message.uid}`;
}

async function refreshAll() {
  try {
    const [folders] = await Promise.all([api.mailboxes(props.account.id), loadFirstPage()]);
    mailboxes.value = folders.mailboxes;
    notify('邮件已刷新');
  } catch (error) {
    handleRequestError(error);
  }
}

function selectMailbox(path) {
  sidebarOpen.value = false;
  if (path === activeMailbox.value && !activeGroup.value) return;
  activeMailbox.value = path;
  activeGroup.value = null;
  query.value = '';
  unfilteredMessages.value = [];
  activeMessage.value = null;
  loadFirstPage();
}

const searchMessages = useDebounceFn(loadFirstPage, 450);

async function openMessage(summary) {
  activeMessage.value = { ...summary };
  detailLoading.value = true;
  try {
    const result = await api.message(props.account.id, activeMailbox.value, summary.uid);
    activeMessage.value = result.message;
    if (!summary.seen) {
      summary.seen = true;
      const folder = mailboxes.value.find((item) => item.path === activeMailbox.value);
      if (folder?.unseen) folder.unseen -= 1;
    }
  } catch (error) {
    activeMessage.value = null;
    handleRequestError(error);
  } finally {
    detailLoading.value = false;
  }
}

async function toggleStar(message) {
  const nextValue = !message.flagged;
  const listMessage = messages.value.find((item) => item.uid === message.uid);
  message.flagged = nextValue;
  if (listMessage) listMessage.flagged = nextValue;
  try {
    await api.updateFlags(props.account.id, activeMailbox.value, [message.uid], { flagged: nextValue });
  } catch (error) {
    message.flagged = !nextValue;
    if (listMessage) listMessage.flagged = !nextValue;
    handleRequestError(error);
  }
}

async function setMessageSeen(message, seen) {
  if (message.seen === seen) return;
  const previous = message.seen;
  const folder = mailboxes.value.find((item) => item.path === activeMailbox.value);
  const previousUnseen = folder?.unseen;
  message.seen = seen;
  if (activeMessage.value?.uid === message.uid) activeMessage.value.seen = seen;
  if (folder) folder.unseen = Math.max(0, (folder.unseen || 0) + (seen ? -1 : 1));

  try {
    await api.updateFlags(props.account.id, activeMailbox.value, [message.uid], { seen });
    notify(seen ? '已标为已读' : '已标为未读');
  } catch (error) {
    message.seen = previous;
    if (activeMessage.value?.uid === message.uid) activeMessage.value.seen = previous;
    if (folder && previousUnseen !== undefined) folder.unseen = previousUnseen;
    handleRequestError(error);
  }
}

function toggleSelect(uid) {
  const next = new Set(selected.value);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  selected.value = next;
}

function toggleAll() {
  const selectable = messages.value.filter((message) => message.kind !== 'group');
  selected.value = selected.value.size === selectable.length
    ? new Set()
    : new Set(selectable.map((message) => message.uid));
}

async function markSelected(seen) {
  const uids = [...selected.value];
  if (!uids.length) return;
  try {
    await api.updateFlags(props.account.id, activeMailbox.value, uids, { seen });
    for (const message of messages.value) {
      if (selected.value.has(message.uid)) message.seen = seen;
    }
    selected.value = new Set();
    notify(seen ? '已标为已读' : '已标为未读');
    mailboxes.value = (await api.mailboxes(props.account.id)).mailboxes;
  } catch (error) {
    handleRequestError(error);
  }
}

async function deleteSelected() {
  const uids = [...selected.value];
  if (!uids.length || !trashFolder.value) return;
  try {
    await api.move(props.account.id, activeMailbox.value, uids, trashFolder.value.path);
    notify(`已将 ${uids.length} 封邮件移至已删除`);
    await refreshAll();
  } catch (error) {
    handleRequestError(error);
  }
}

async function deleteMessage(message) {
  if (!message?.uid || !trashFolder.value || trashFolder.value.path === activeMailbox.value) return;
  try {
    await api.move(props.account.id, activeMailbox.value, [message.uid], trashFolder.value.path);
    notify('邮件已移至已删除');
    await refreshAll();
  } catch (error) {
    handleRequestError(error);
  }
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

function showAggregationDialog(message) {
  aggregationTarget.value = message;
}

function applyOptimisticAggregation(message, rule) {
  const matchesRule = (item) => {
    if (item.kind === 'group') return false;
    if (rule.type === 'sender') {
      return item.from?.some((address) => (
        String(address?.address || '').trim().toLocaleLowerCase() === rule.value
      ));
    }
    return normalizeAggregationSubject(item.subject) === rule.value;
  };
  const matched = messages.value.filter(matchesRule);
  if (!matched.length) matched.push(message);
  const matchedUids = new Set(matched.map((item) => item.uid));
  const latest = sortMessagesNewestFirst(matched)[0];
  const unread = matched.reduce((count, item) => count + (item.seen ? 0 : 1), 0);
  const group = {
    kind: 'group',
    key: `group:${rule.id}`,
    groupId: rule.id,
    ruleId: rule.id,
    groupType: rule.type,
    label: rule.label,
    count: matched.length,
    unread,
    seen: unread === 0,
    flagged: matched.some((item) => item.flagged),
    date: latest.date,
    latestUid: latest.uid,
    latestSubject: latest.subject,
    subject: rule.label,
    from: latest.from,
    to: latest.to,
  };
  messages.value = sortMessagesNewestFirst([
    ...messages.value.filter((item) => !matchedUids.has(item.uid)),
    group,
  ]);
  total.value = Math.max(messages.value.length, total.value - Math.max(0, matched.length - 1));
  unfilteredMessages.value = messages.value;
  selected.value = new Set();
}

function normalizeAggregationSubject(value) {
  let subject = String(value || '').trim();
  const prefix = /^(?:(?:re|fw|fwd)\s*[:：]|回复\s*[:：]|答复\s*[:：]|转发\s*[:：])\s*/i;
  while (prefix.test(subject)) subject = subject.replace(prefix, '').trim();
  return subject.replace(/\s+/g, ' ').toLocaleLowerCase();
}

async function createAggregation(type, target = aggregationTarget.value) {
  const message = target;
  if (!message || aggregationBusy.value) return;

  const sender = message.from?.[0];
  const value = type === 'sender' ? sender?.address : message.subject;
  const label = type === 'sender'
    ? (sender?.name || sender?.address)
    : message.subject;
  if (!value) {
    notify(type === 'sender' ? '这封邮件没有可用的发件人地址' : '这封邮件没有可用的主题', 'error');
    return;
  }

  aggregationBusy.value = true;
  try {
    const result = await api.createAggregationRule(props.account.id, {
      type,
      value,
      label,
      mailbox: activeMailbox.value,
      uid: message.uid,
    });
    const canUpdateImmediately = !query.value.trim() && !activeGroup.value;
    aggregationTarget.value = null;
    activeGroup.value = null;
    query.value = '';
    if (canUpdateImmediately) {
      applyOptimisticAggregation(message, result.rule);
      loadFirstPage({ silent: true });
    } else {
      unfilteredMessages.value = [];
      await loadFirstPage();
    }
    notify(result.created ? '聚合规则已创建' : '该聚合规则已经存在');
  } catch (error) {
    handleRequestError(error);
  } finally {
    aggregationBusy.value = false;
  }
}

function createAggregationFromMenu(message, type) {
  createAggregation(type, message);
}

async function removeGroup(group) {
  try {
    await api.deleteAggregationRule(props.account.id, group.ruleId);
    if (activeGroup.value?.ruleId === group.ruleId) activeGroup.value = null;
    await loadFirstPage();
    notify('已取消聚合');
  } catch (error) {
    handleRequestError(error);
  }
}

function confirmDisconnect() {
  sidebarOpen.value = false;
  confirmOpen.value = true;
}

function disconnect() {
  confirmOpen.value = false;
  emit('disconnect');
}

function handleRequestError(error) {
  if (error.status === 401) {
    emit('session-expired');
    return;
  }
  notify(error.message || '操作失败，请稍后重试', 'error');
}
</script>

<template>
  <div class="mail-workspace">
    <div class="sidebar-shell" :class="{ 'is-open': sidebarOpen }">
      <button
        type="button"
        class="sidebar-scrim"
        aria-label="关闭文件夹侧栏"
        :tabindex="sidebarOpen ? 0 : -1"
        @click="sidebarOpen = false"
      ></button>
      <MailSidebar
        id="mail-folder-sidebar"
        :inert="isSmallScreen && !sidebarOpen"
        :aria-hidden="isSmallScreen && !sidebarOpen ? 'true' : undefined"
        :mailboxes="mailboxes"
        :active-mailbox="activeMailbox"
        @select="selectMailbox"
        @logout="confirmDisconnect"
      />
    </div>

    <main class="mail-main">
      <header class="mail-header">
        <button
          type="button"
          class="folder-drawer-trigger square-control"
          aria-label="打开文件夹侧栏"
          aria-controls="mail-folder-sidebar"
          :aria-expanded="sidebarOpen"
          @click="sidebarOpen = true"
        >
          <PanelLeft :size="18" />
        </button>
        <label class="mail-search">
          <Search :size="17" />
          <input
            v-model="query"
            type="search"
            :disabled="Boolean(activeGroup)"
            :placeholder="activeGroup ? `正在查看：${activeGroup.label}` : '搜索发件人、主题或正文'"
            @input="searchMessages"
          />
          <button v-if="query" type="button" aria-label="清除搜索" @click="clearSearch"><X :size="15" /></button>
        </label>
      </header>

      <MessageList
        :messages="messages"
        :loading="listLoading"
        :loading-more="loadingMore"
        :selected="selected"
        :total="total"
        :query="query"
        :has-more="hasMore"
        :trash-available="Boolean(trashFolder && trashFolder.path !== activeMailbox)"
        :group="activeGroup"
        @open="openMessage"
        @open-group="openGroup"
        @back-group="leaveGroup"
        @aggregate="showAggregationDialog"
        @aggregate-as="createAggregationFromMenu"
        @remove-group="removeGroup"
        @toggle-select="toggleSelect"
        @toggle-all="toggleAll"
        @toggle-star="toggleStar"
        @set-seen="setMessageSeen"
        @refresh="refreshAll"
        @mark-seen="markSelected"
        @delete="deleteSelected"
        @delete-one="deleteMessage"
        @load-more="loadMore"
      />
    </main>

    <MessageDetail
      v-if="activeMessage"
      :account-id="account.id"
      :message="activeMessage"
      :loading="detailLoading"
      :mailbox="activeMailbox"
      @close="activeMessage = null"
      @toggle-star="toggleStar"
    />

    <Teleport to="body">
      <Transition name="modal">
        <div v-if="confirmOpen" class="modal-layer" role="presentation" @click.self="confirmOpen = false">
          <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="disconnect-title">
            <p id="disconnect-title">退出当前邮箱？</p>
            <small :title="account.email">{{ account.email }}</small>
            <div class="confirm-dialog__actions">
              <button type="button" class="secondary-button" @click="confirmOpen = false">取消</button>
              <button type="button" class="danger-button" @click="disconnect">退出</button>
            </div>
          </section>
        </div>
      </Transition>
      <Transition name="modal">
        <div
          v-if="aggregationTarget"
          class="modal-layer"
          role="presentation"
          @click.self="aggregationTarget = null"
        >
          <section class="aggregation-dialog" role="dialog" aria-modal="true" aria-label="选择聚合方式">
            <div class="aggregation-options">
              <button
                type="button"
                :disabled="aggregationBusy || !aggregationTarget.from?.[0]?.address"
                @click="createAggregation('sender')"
              >
                <AtSign :size="14" />
                <span>按发件人聚合</span>
              </button>
              <button
                type="button"
                :disabled="aggregationBusy || !aggregationTarget.subject"
                @click="createAggregation('subject')"
              >
                <CaseSensitive :size="14" />
                <span>按主题聚合</span>
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
