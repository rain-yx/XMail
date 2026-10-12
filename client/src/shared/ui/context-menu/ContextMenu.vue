<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import ContextMenuItem from './ContextMenuItem.vue';

defineOptions({ name: 'ContextMenu' });

const props = defineProps({
  items: { type: Array, default: () => [] },
  ariaLabel: { type: String, default: '操作菜单' },
});
const emit = defineEmits(['action', 'close']);

const menuRef = ref(null);
const visible = ref(false);
const left = ref(0);
const top = ref(0);
const submenuDirection = ref('right');
const visibleItems = computed(() => props.items.filter((item) => !item.hidden));
const instanceId = Symbol('xmail-context-menu');
const showEvent = 'xmail-context-menu:show';

async function open(event) {
  if (!event || !visibleItems.value.length) return;
  window.dispatchEvent(new CustomEvent(showEvent, { detail: instanceId }));

  const pointerX = event.clientX;
  const pointerY = event.clientY;
  left.value = pointerX + 2;
  top.value = pointerY + 2;
  submenuDirection.value = 'right';
  visible.value = true;
  await nextTick();

  const menu = menuRef.value;
  if (!menu) return;
  const margin = 6;
  const rect = menu.getBoundingClientRect();
  left.value = Math.max(margin, Math.min(pointerX + 2, window.innerWidth - rect.width - margin));
  top.value = Math.max(margin, Math.min(pointerY + 2, window.innerHeight - rect.height - margin));
  submenuDirection.value = pointerX + rect.width * 2 + margin > window.innerWidth ? 'left' : 'right';
  menu.focus({ preventScroll: true });
}

function close() {
  if (!visible.value) return;
  visible.value = false;
  emit('close');
}

function select(item) {
  if (item.disabled || item.children?.length) return;
  emit('action', item);
  close();
}

function handlePointerDown(event) {
  if (visible.value && !menuRef.value?.contains(event.target)) close();
}

function handleContextMenu(event) {
  if (visible.value && !menuRef.value?.contains(event.target)) close();
}

function handleKeydown(event) {
  if (!visible.value) return;
  if (event.key === 'Escape' || event.key === 'Tab') {
    close();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

  event.preventDefault();
  const buttons = [...menuRef.value.querySelectorAll('button:not(:disabled)')]
    .filter((button) => button.offsetParent !== null);
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement);
  let next = 0;
  if (event.key === 'End') next = buttons.length - 1;
  else if (event.key === 'ArrowUp') next = current <= 0 ? buttons.length - 1 : current - 1;
  else if (event.key === 'ArrowDown') next = current >= buttons.length - 1 ? 0 : current + 1;
  buttons[next].focus({ preventScroll: true });
}

function handleOtherMenu(event) {
  if (event.detail !== instanceId) close();
}

function handleVisibilityChange() {
  if (document.hidden) close();
}

onMounted(() => {
  window.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', close, true);
  window.addEventListener(showEvent, handleOtherMenu);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handlePointerDown, true);
  window.removeEventListener('contextmenu', handleContextMenu);
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('blur', close);
  window.removeEventListener('resize', close);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener(showEvent, handleOtherMenu);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

defineExpose({ open, close });
</script>

<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <ul
        v-if="visible"
        ref="menuRef"
        class="context-menu"
        :style="{ left: `${left}px`, top: `${top}px` }"
        role="menu"
        :aria-label="ariaLabel"
        tabindex="-1"
        @contextmenu.prevent
      >
        <ContextMenuItem
          v-for="item in visibleItems"
          :key="item.id || item.label"
          :item="item"
          :direction="submenuDirection"
          @select="select"
        />
      </ul>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  min-width: 174px;
  position: fixed;
  z-index: 9999;
  margin: 0;
  padding: 0;
  list-style: none;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 10px 28px rgb(31 43 70 / 16%);
  outline: none;
  user-select: none;
}
.context-menu-enter-active,
.context-menu-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}
.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
