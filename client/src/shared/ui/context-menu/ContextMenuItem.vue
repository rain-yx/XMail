<script setup>
import { computed, nextTick, ref } from 'vue';
import { ChevronRight } from 'lucide-vue-next';

defineOptions({ name: 'ContextMenuItem' });

const props = defineProps({
  item: { type: Object, required: true },
  direction: { type: String, default: 'right' },
});
const emit = defineEmits(['select']);

const rowRef = ref(null);
const submenuRef = ref(null);
const submenuOpen = ref(false);
const submenuDirection = ref(props.direction);
const submenuTop = ref(-5);
const visibleChildren = computed(() => (
  (props.item.children || []).filter((item) => !item.hidden)
));
const hasChildren = computed(() => visibleChildren.value.length > 0);

async function openSubmenu(focusFirst = false) {
  if (!hasChildren.value || props.item.disabled) return;
  submenuOpen.value = true;
  submenuTop.value = -5;
  await nextTick();

  const rowRect = rowRef.value?.getBoundingClientRect();
  const submenu = submenuRef.value;
  if (!rowRect || !submenu) return;

  const submenuWidth = submenu.offsetWidth;
  const rightSpace = window.innerWidth - rowRect.right;
  const leftSpace = rowRect.left;
  submenuDirection.value = rightSpace >= submenuWidth + 4 || rightSpace >= leftSpace ? 'right' : 'left';
  await nextTick();

  const rect = submenu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 6) submenuTop.value -= rect.bottom - window.innerHeight + 6;
  if (rect.top < 6) submenuTop.value += 6 - rect.top;

  if (focusFirst) {
    await nextTick();
    submenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
}

function closeSubmenu(event) {
  if (event?.relatedTarget && rowRef.value?.contains(event.relatedTarget)) return;
  submenuOpen.value = false;
}

function closeSubmenuFromKeyboard() {
  submenuOpen.value = false;
  nextTick(() => {
    rowRef.value?.querySelector(':scope > .context-menu-item__button')?.focus({ preventScroll: true });
  });
}

function selectItem() {
  if (props.item.disabled) return;
  if (hasChildren.value) {
    openSubmenu(true);
    return;
  }
  emit('select', props.item);
}
</script>

<template>
  <li v-if="item.type === 'separator'" class="context-menu-separator" role="separator"></li>
  <li
    v-else
    ref="rowRef"
    class="context-menu-item"
    :class="{ 'has-children': hasChildren, 'is-danger': item.danger }"
    role="none"
    @mouseenter="openSubmenu(false)"
    @mouseleave="closeSubmenu"
  >
    <button
      type="button"
      class="context-menu-item__button"
      role="menuitem"
      :disabled="item.disabled"
      :aria-haspopup="hasChildren ? 'menu' : undefined"
      :aria-expanded="hasChildren ? submenuOpen : undefined"
      @click="selectItem"
      @keydown.right.prevent="openSubmenu(true)"
    >
      <component :is="item.icon" v-if="item.icon" class="context-menu-item__icon" :size="14" />
      <span class="context-menu-item__label">{{ item.label }}</span>
      <span v-if="item.shortcut" class="context-menu-item__shortcut">{{ item.shortcut }}</span>
      <ChevronRight v-if="hasChildren" class="context-menu-item__arrow" :size="13" />
    </button>

    <ul
      v-if="hasChildren && submenuOpen"
      ref="submenuRef"
      class="context-submenu"
      :class="{ 'is-left': submenuDirection === 'left' }"
      :style="{ top: `${submenuTop}px` }"
      role="menu"
      @keydown.left.stop.prevent="closeSubmenuFromKeyboard"
    >
      <ContextMenuItem
        v-for="child in visibleChildren"
        :key="child.id || child.label"
        :item="child"
        :direction="submenuDirection"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
.context-menu-item {
  min-width: 166px;
  position: relative;
  margin: 4px;
  border-radius: 4px;
  user-select: none;
}
.context-menu-item__button {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  color: #566176;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
}
.context-menu-item__button:hover:not(:disabled),
.context-menu-item__button:focus-visible {
  color: var(--primary);
  background: #eef2ff;
  outline: none;
}
.context-menu-item__button:disabled {
  color: #a8b0bf;
  cursor: not-allowed;
}
.context-menu-item__icon {
  flex: 0 0 auto;
  color: #8b95a7;
}
.context-menu-item__button:hover:not(:disabled) .context-menu-item__icon,
.context-menu-item__button:focus-visible .context-menu-item__icon {
  color: var(--primary);
}
.context-menu-item__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.context-menu-item__shortcut {
  color: #929caf;
  font-size: 10px;
}
.context-menu-item__arrow {
  flex: 0 0 auto;
  color: #8b95a7;
}
.context-menu-item.is-danger > .context-menu-item__button {
  color: #d94d4d;
}
.context-menu-item.is-danger > .context-menu-item__button:hover:not(:disabled),
.context-menu-item.is-danger > .context-menu-item__button:focus-visible {
  color: #c73d3d;
  background: #fff0f0;
}
.context-menu-item.is-danger > .context-menu-item__button .context-menu-item__icon {
  color: currentColor;
}
.context-menu-separator {
  height: 1px;
  margin: 5px 9px;
  overflow: hidden;
  background: #e8ebf1;
  transform: scaleY(0.5);
  transform-origin: center;
}
.context-submenu {
  min-width: 174px;
  position: absolute;
  left: calc(100% - 2px);
  z-index: 1;
  margin: 0;
  padding: 0;
  list-style: none;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 10px 28px rgb(31 43 70 / 16%);
}
.context-submenu.is-left {
  right: calc(100% - 2px);
  left: auto;
}
</style>
