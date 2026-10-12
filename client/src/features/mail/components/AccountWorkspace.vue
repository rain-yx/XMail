<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { AtSign, CaseSensitive, PanelLeft, Search, X } from 'lucide-vue-next';
import { notify } from '@/shared/ui/toast/toast-store.js';
import { useAggregation } from '../composables/useAggregation.js';
import { useMailboxState } from '../composables/useMailboxState.js';
import { useMessageActions } from '../composables/useMessageActions.js';
import { useNewMailStream } from '../composables/useNewMailStream.js';
import MailSidebar from './MailSidebar.vue';
import MessageDetail from './MessageDetail.vue';
import MessageList from './MessageList.vue';

const props = defineProps({
  account: { type: Object, required: true },
  inboxRequest: { type: Number, default: 0 },
});
const emit = defineEmits(['disconnect', 'session-expired', 'new-mail']);

const confirmOpen = ref(false);
const sidebarOpen = ref(false);
const isSmallScreen = useMediaQuery('(max-width: 760px)');

const state = useMailboxState(props.account, handleRequestError);
const actions = useMessageActions(props.account, state, handleRequestError);
const aggregation = useAggregation(props.account, state, handleRequestError);
const newMailStream = useNewMailStream(props.account, state, {
  onNewMail: (payload) => emit('new-mail', payload),
  onSessionExpired: () => emit('session-expired'),
});

const {
  mailboxes,
  activeMailbox,
  messages,
  total,
  query,
  listLoading,
  loadingMore,
  activeMessage,
  selected,
  activeGroup,
  trashFolder,
  hasMore,
  loadMore,
  refreshAll,
  clearSearch,
  openGroup,
  leaveGroup,
  searchMessages,
} = state;
const {
  detailLoading,
  openMessage,
  toggleStar,
  setMessageSeen,
  toggleSelect,
  toggleAll,
  markSelected,
  deleteSelected,
  deleteMessage,
} = actions;
const {
  aggregationTarget,
  aggregationBusy,
  showAggregationDialog,
  createAggregation,
  createAggregationFromMenu,
  removeGroup,
} = aggregation;

onMounted(initializeMailbox);
onMounted(() => window.addEventListener('keydown', handleGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', handleGlobalKeydown));
watch(isSmallScreen, (small) => {
  if (!small) sidebarOpen.value = false;
});
watch(() => props.inboxRequest, showInbox);

async function initializeMailbox() {
  try {
    const inboxPath = await state.initializeFolders();
    await newMailStream.initialize(inboxPath);
    await state.loadFirstPage();
  } catch (error) {
    handleRequestError(error);
  }
}

function handleGlobalKeydown(event) {
  if (event.key !== 'Escape') return;
  sidebarOpen.value = false;
  confirmOpen.value = false;
  aggregationTarget.value = null;
}

function selectMailbox(path) {
  sidebarOpen.value = false;
  state.selectMailbox(path);
}

function showInbox() {
  sidebarOpen.value = false;
  state.showInbox();
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
          <button v-if="query" type="button" aria-label="清除搜索" @click="clearSearch">
            <X :size="15" />
          </button>
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

<style scoped src="./AccountWorkspace.css"></style>
