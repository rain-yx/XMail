<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDebounceFn, useMediaQuery } from '@vueuse/core';
import { LogOut, PanelLeft, Search, X } from 'lucide-vue-next';
import { api } from '../api.js';
import { notify } from '../toast.js';
import MailSidebar from './MailSidebar.vue';
import MessageDetail from './MessageDetail.vue';
import MessageList from './MessageList.vue';

const props = defineProps({ account: { type: Object, required: true } });
const emit = defineEmits(['disconnect', 'session-expired']);

const mailboxes = ref([]);
const activeMailbox = ref('INBOX');
const messages = ref([]);
const total = ref(0);
const page = ref(0);
const pageSize = 40;
const query = ref('');
const listLoading = ref(false);
const loadingMore = ref(false);
const detailLoading = ref(false);
const activeMessage = ref(null);
const selected = ref(new Set());
const confirmOpen = ref(false);
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
  if (event.key === 'Escape') sidebarOpen.value = false;
}

async function initializeMailbox() {
  try {
    const result = await api.mailboxes(props.account.id);
    mailboxes.value = result.mailboxes;
    const inbox = mailboxes.value.find((mailbox) => mailbox.specialUse === '\\Inbox');
    activeMailbox.value = inbox?.path || 'INBOX';
    await loadFirstPage();
  } catch (error) {
    handleRequestError(error);
  }
}

async function loadFirstPage() {
  const requestId = ++listRequestId;
  listLoading.value = true;
  selected.value = new Set();
  page.value = 0;
  try {
    const result = await api.messages(props.account.id, {
      mailbox: activeMailbox.value,
      page: 1,
      pageSize,
      query: query.value.trim(),
    });
    if (requestId !== listRequestId) return;
    messages.value = result.messages;
    total.value = result.total;
    page.value = 1;
  } catch (error) {
    if (requestId === listRequestId) handleRequestError(error);
  } finally {
    if (requestId === listRequestId) listLoading.value = false;
  }
}

async function loadMore() {
  if (listLoading.value || loadingMore.value || !hasMore.value) return;
  const requestId = listRequestId;
  loadingMore.value = true;
  const nextPage = page.value + 1;
  try {
    const result = await api.messages(props.account.id, {
      mailbox: activeMailbox.value,
      page: nextPage,
      pageSize,
      query: query.value.trim(),
    });
    if (requestId !== listRequestId) return;
    const known = new Set(messages.value.map((message) => message.uid));
    messages.value.push(...result.messages.filter((message) => !known.has(message.uid)));
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
    const [folders] = await Promise.all([api.mailboxes(props.account.id), loadFirstPage()]);
    mailboxes.value = folders.mailboxes;
    notify('邮件已刷新');
  } catch (error) {
    handleRequestError(error);
  }
}

function selectMailbox(path) {
  sidebarOpen.value = false;
  if (path === activeMailbox.value) return;
  activeMailbox.value = path;
  query.value = '';
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

function toggleSelect(uid) {
  const next = new Set(selected.value);
  if (next.has(uid)) next.delete(uid);
  else next.add(uid);
  selected.value = next;
}

function toggleAll() {
  selected.value = selected.value.size === messages.value.length
    ? new Set()
    : new Set(messages.value.map((message) => message.uid));
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

function clearSearch() {
  query.value = '';
  loadFirstPage();
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
          <input v-model="query" type="search" placeholder="搜索发件人、主题或正文" @input="searchMessages" />
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
        :trash-available="Boolean(trashFolder)"
        @open="openMessage"
        @toggle-select="toggleSelect"
        @toggle-all="toggleAll"
        @toggle-star="toggleStar"
        @refresh="refreshAll"
        @mark-seen="markSelected"
        @delete="deleteSelected"
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
            <span class="confirm-dialog__icon"><LogOut :size="22" /></span>
            <h2 id="disconnect-title">退出邮箱</h2>
            <p>确认退出 <strong>{{ account.email }}</strong>？该账号的内存凭据会立即清除。</p>
            <div class="confirm-dialog__actions">
              <button type="button" class="secondary-button" @click="confirmOpen = false">取消</button>
              <button type="button" class="danger-button" @click="disconnect">退出</button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
