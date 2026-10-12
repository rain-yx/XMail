<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowUp,
  AtSign,
  CaseSensitive,
  Inbox,
  Layers3,
  Mail,
  MailOpen,
  RefreshCw,
  SearchX,
  Star,
  Trash2,
  X,
} from 'lucide-vue-next';
import { useLenisContainer } from '../useLenis.js';
import { formatMailDate, getVisibleRange } from '../virtual-list.js';
import ContextMenu from './ContextMenu.vue';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  loading: Boolean,
  loadingMore: Boolean,
  selected: { type: Object, required: true },
  total: { type: Number, default: 0 },
  query: { type: String, default: '' },
  hasMore: Boolean,
  trashAvailable: Boolean,
  group: { type: Object, default: null },
});

const emit = defineEmits([
  'open',
  'toggle-select',
  'toggle-all',
  'toggle-star',
  'refresh',
  'mark-seen',
  'delete',
  'load-more',
  'open-group',
  'back-group',
  'aggregate',
  'aggregate-as',
  'remove-group',
  'set-seen',
  'delete-one',
]);

const BUFFER_ROWS = 5;
const viewportRef = ref(null);
const contentRef = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const rowHeight = ref(35);
const footerHeight = ref(44);
const contextMenuRef = ref(null);
const contextTarget = ref(null);
let lastEndRequestLength = -1;

const showFooter = computed(() => props.loadingMore || !props.hasMore);
const showBackToTop = computed(() => scrollTop.value > Math.max(240, rowHeight.value * 6));
const selectableMessages = computed(() => props.messages.filter((message) => message.kind !== 'group'));
const contextRowKey = computed(() => (
  contextTarget.value ? rowKey(contextTarget.value) : ''
));
const contextMenuItems = computed(() => {
  const message = contextTarget.value;
  if (!message) return [];
  if (message.kind === 'group') {
    return [
      { id: 'open-group', label: `打开聚合（${message.count} 封）`, icon: Layers3 },
      { id: 'group-separator', type: 'separator' },
      { id: 'remove-group', label: '取消聚合', icon: X, danger: true },
    ];
  }

  return [
    { id: 'open', label: '打开邮件', icon: MailOpen, shortcut: 'Enter' },
    { id: 'message-separator-1', type: 'separator' },
    {
      id: 'set-seen',
      label: message.seen ? '标为未读' : '标为已读',
      icon: message.seen ? Mail : MailOpen,
    },
    {
      id: 'toggle-star',
      label: message.flagged ? '取消星标' : '添加星标',
      icon: Star,
    },
    {
      id: 'aggregate-menu',
      label: '聚合此类邮件',
      icon: Layers3,
      children: [
        {
          id: 'aggregate-sender',
          label: '按发件人聚合',
          icon: AtSign,
          disabled: !message.from?.[0]?.address,
        },
        {
          id: 'aggregate-subject',
          label: '按主题聚合',
          icon: CaseSensitive,
          disabled: !message.subject,
        },
      ],
    },
    { id: 'message-separator-2', type: 'separator', hidden: !props.trashAvailable },
    {
      id: 'delete-one',
      label: '移至已删除',
      icon: Trash2,
      danger: true,
      hidden: !props.trashAvailable,
    },
  ];
});
const rowsHeight = computed(() => props.messages.length * rowHeight.value);
const totalHeight = computed(() => rowsHeight.value + (showFooter.value ? footerHeight.value : 0));
const visibleRows = computed(() => {
  const { start, end } = getVisibleRange({
    scrollTop: scrollTop.value,
    viewportHeight: viewportHeight.value,
    rowHeight: rowHeight.value,
    total: props.messages.length,
    buffer: BUFFER_ROWS,
  });
  return props.messages.slice(start, end).map((message, offset) => ({
    message,
    index: start + offset,
  }));
});

const lenis = useLenisContainer(viewportRef, contentRef, {
  duration: 0.58,
  onScroll: ({ scroll }) => {
    scrollTop.value = scroll;
    maybeLoadMore(scroll);
  },
  onResize: updateViewport,
  onReady: () => {
    updateViewport();
    maybeLoadMore(0);
  },
});

watch(() => props.messages.length, async () => {
  await nextTick();
  lenis.resize();
  updateViewport();
  maybeLoadMore(scrollTop.value);
});

watch(() => props.loading, (loading) => {
  if (!loading) return;
  contextMenuRef.value?.close();
  lastEndRequestLength = -1;
  scrollTop.value = 0;
  lenis.scrollTo(0, { immediate: true });
});

function updateViewport() {
  rowHeight.value = measureRowHeight();
  footerHeight.value = readCssLength('--message-footer-height', 44);
  viewportHeight.value = viewportRef.value?.clientHeight || 0;
}

function measureRowHeight() {
  const renderedRow = contentRef.value?.querySelector('.message-row');
  const measuredHeight = renderedRow?.getBoundingClientRect().height;
  return measuredHeight > 0
    ? measuredHeight
    : readCssLength('--message-row-height', 35);
}

function readCssLength(property, fallback) {
  if (typeof document === 'undefined') return fallback;
  const rootStyle = getComputedStyle(document.documentElement);
  const value = rootStyle.getPropertyValue(property).trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  if (value.endsWith('rem')) {
    const rootSize = Number.parseFloat(rootStyle.fontSize);
    return amount * (Number.isFinite(rootSize) ? rootSize : 16);
  }
  return amount;
}

function maybeLoadMore(scroll = scrollTop.value) {
  if (!props.hasMore || props.loading || props.loadingMore || !viewportHeight.value) return;
  const threshold = rowHeight.value * 4;
  if (rowsHeight.value - (scroll + viewportHeight.value) > threshold) return;
  if (lastEndRequestLength === props.messages.length) return;
  lastEndRequestLength = props.messages.length;
  emit('load-more');
}

function sender(message) {
  const from = message.from?.[0];
  return from?.name || from?.address || '未知发件人';
}

function isSelected(uid) {
  return props.selected.has(uid);
}

function rowKey(message) {
  return message.kind === 'group' ? `group:${message.groupId}` : `message:${message.uid}`;
}

function openRow(message) {
  emit(message.kind === 'group' ? 'open-group' : 'open', message);
}

async function openContextMenu(event, message) {
  contextTarget.value = message;
  await nextTick();
  contextMenuRef.value?.open(event);
}

function handleContextAction(item) {
  const message = contextTarget.value;
  if (!message) return;
  switch (item.id) {
    case 'open':
      emit('open', message);
      break;
    case 'open-group':
      emit('open-group', message);
      break;
    case 'set-seen':
      emit('set-seen', message, !message.seen);
      break;
    case 'toggle-star':
      emit('toggle-star', message);
      break;
    case 'aggregate-sender':
      emit('aggregate-as', message, 'sender');
      break;
    case 'aggregate-subject':
      emit('aggregate-as', message, 'subject');
      break;
    case 'delete-one':
      emit('delete-one', message);
      break;
    case 'remove-group':
      emit('remove-group', message);
      break;
    default:
      break;
  }
}

function scrollToTop() {
  lenis.scrollTo(0, { duration: 0.45 });
}
</script>

<template>
  <section class="message-list" aria-label="邮件列表">
    <div class="list-toolbar">
      <button
        v-if="group"
        type="button"
        class="group-back-button"
        title="返回聚合列表"
        @click="emit('back-group')"
      >
        <ArrowLeft :size="15" />
        <span>{{ group.label }}</span>
      </button>
      <label class="native-checkbox" title="全选已加载邮件">
        <input
          type="checkbox"
          :checked="selectableMessages.length > 0 && selected.size === selectableMessages.length"
          :indeterminate="selected.size > 0 && selected.size < selectableMessages.length"
          aria-label="全选已加载邮件"
          @change="emit('toggle-all')"
        />
      </label>

      <template v-if="selected.size">
        <span class="native-button-group">
          <button type="button" title="标为已读" @click="emit('mark-seen', true)"><MailOpen :size="13" /></button>
          <button type="button" title="标为未读" @click="emit('mark-seen', false)"><Mail :size="13" /></button>
          <button v-if="trashAvailable" type="button" title="移至已删除" @click="emit('delete')"><Trash2 :size="13" /></button>
        </span>
        <span class="selection-tag">已选 {{ selected.size }} 封</span>
      </template>
      <span v-else class="native-button-group">
        <button type="button" title="刷新" :disabled="loading" @click="emit('refresh')">
          <RefreshCw :size="13" :class="{ 'spin': loading }" />
        </button>
      </span>

      <span class="toolbar-spacer"></span>
      <span class="list-count">已加载 {{ messages.length }} / {{ total }}</span>
    </div>

    <div v-if="loading" class="message-loading" aria-label="正在读取邮件">
      <div v-for="item in 8" :key="item" class="message-skeleton skeleton-row">
        <i class="skeleton-avatar"></i><span><i></i><i></i></span>
      </div>
    </div>

    <div v-else-if="!messages.length" class="message-empty">
      <SearchX v-if="query" :size="42" /><Inbox v-else :size="42" />
      <h3>{{ query ? '没有找到匹配的邮件' : '这里还没有邮件' }}</h3>
      <p>{{ query ? '请尝试其他关键词' : '新邮件到达后会显示在这里' }}</p>
    </div>

    <div v-else class="virtual-list-host">
      <div ref="viewportRef" class="virtual-viewport">
        <div ref="contentRef" class="virtual-content" :style="{ height: `${totalHeight}px` }">
          <article
            v-for="row in visibleRows"
            :key="rowKey(row.message)"
            class="message-row"
            :class="{
              'message-row--group': row.message.kind === 'group',
              'message-row--unread': !row.message.seen,
              'message-row--selected': isSelected(row.message.uid),
              'message-row--context': rowKey(row.message) === contextRowKey,
            }"
            :style="{ transform: `translateY(${row.index * rowHeight}px)` }"
            tabindex="0"
            @click="openRow(row.message)"
            @keydown.enter="openRow(row.message)"
            @contextmenu.prevent.stop="openContextMenu($event, row.message)"
          >
            <template v-if="row.message.kind === 'group'">
              <span class="group-row-marker" aria-hidden="true"><Layers3 :size="17" /></span>
            </template>
            <template v-else>
              <label class="native-checkbox" title="选择邮件" @click.stop>
                <input
                  type="checkbox"
                  :checked="isSelected(row.message.uid)"
                  aria-label="选择邮件"
                  @change="emit('toggle-select', row.message.uid)"
                />
              </label>
              <button
                type="button"
                class="square-control star-button"
                :class="{ 'is-active': row.message.flagged }"
                :aria-label="row.message.flagged ? '取消星标' : '添加星标'"
                @click.stop="emit('toggle-star', row.message)"
              >
                <Star :size="14" :fill="row.message.flagged ? 'currentColor' : 'none'" />
              </button>
              <button
                type="button"
                class="square-control aggregate-button"
                aria-label="聚合此类邮件"
                title="聚合此类邮件"
                @click.stop="emit('aggregate', row.message)"
              >
                <Layers3 :size="14" />
              </button>
            </template>
            <div class="message-copy">
              <strong>{{ row.message.kind === 'group' ? row.message.label : sender(row.message) }}</strong>
              <p>{{ row.message.kind === 'group' ? `最新：${row.message.latestSubject}` : (row.message.subject || '（无主题）') }}</p>
              <span v-if="row.message.kind === 'group'" class="group-count">
                {{ row.message.count }} 封
                <em v-if="row.message.unread">{{ row.message.unread }} 未读</em>
              </span>
              <time :datetime="row.message.date">{{ formatMailDate(row.message.date) }}</time>
            </div>
            <button
              v-if="row.message.kind === 'group'"
              type="button"
              class="square-control group-remove-button"
              aria-label="取消聚合"
              title="取消聚合"
              @click.stop="emit('remove-group', row.message)"
            >
              <X :size="14" />
            </button>
          </article>
          <div
            v-if="showFooter"
            class="load-more-status"
            :style="{ top: `${rowsHeight}px`, height: `${footerHeight}px` }"
          >
            <template v-if="loadingMore"><RefreshCw :size="13" class="spin" /> 正在加载更多</template>
            <template v-else>已加载全部邮件</template>
          </div>
        </div>
      </div>
      <Transition name="back-to-top">
        <button
          v-if="showBackToTop"
          type="button"
          class="back-to-top-button"
          aria-label="返回列表顶部"
          title="返回顶部"
          @click="scrollToTop"
        >
          <ArrowUp :size="17" />
        </button>
      </Transition>
    </div>
    <ContextMenu
      ref="contextMenuRef"
      :items="contextMenuItems"
      aria-label="邮件操作菜单"
      @action="handleContextAction"
      @close="contextTarget = null"
    />
  </section>
</template>
