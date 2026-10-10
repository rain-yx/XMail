<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import {
  Inbox,
  Mail,
  MailOpen,
  RefreshCw,
  SearchX,
  Star,
  Trash2,
} from 'lucide-vue-next';
import { useLenisContainer } from '../useLenis.js';
import { formatMailDate, getVisibleRange } from '../virtual-list.js';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  loading: Boolean,
  loadingMore: Boolean,
  selected: { type: Object, required: true },
  total: { type: Number, default: 0 },
  query: { type: String, default: '' },
  hasMore: Boolean,
  trashAvailable: Boolean,
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
]);

const BUFFER_ROWS = 5;
const viewportRef = ref(null);
const contentRef = ref(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const rowHeight = ref(35);
const footerHeight = ref(44);
let lastEndRequestLength = -1;

const showFooter = computed(() => props.loadingMore || !props.hasMore);
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
</script>

<template>
  <section class="message-list" aria-label="邮件列表">
    <div class="list-toolbar">
      <label class="native-checkbox" title="全选已加载邮件">
        <input
          type="checkbox"
          :checked="messages.length > 0 && selected.size === messages.length"
          :indeterminate="selected.size > 0 && selected.size < messages.length"
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
            :key="row.message.uid"
            class="message-row"
            :class="{
              'message-row--unread': !row.message.seen,
              'message-row--selected': isSelected(row.message.uid),
            }"
            :style="{ transform: `translateY(${row.index * rowHeight}px)` }"
            tabindex="0"
            @click="emit('open', row.message)"
            @keydown.enter="emit('open', row.message)"
          >
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
            <div class="message-copy">
              <strong>{{ sender(row.message) }}</strong>
              <p>{{ row.message.subject || '（无主题）' }}</p>
              <time :datetime="row.message.date">{{ formatMailDate(row.message.date) }}</time>
            </div>
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
    </div>
  </section>
</template>
