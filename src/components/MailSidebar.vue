<script setup>
import { ref } from 'vue';
import {
  Archive,
  FileText,
  Folder,
  Inbox,
  LogOut,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-vue-next';
import { useLenisContainer } from '../useLenis.js';

defineProps({
  mailboxes: { type: Array, default: () => [] },
  activeMailbox: { type: String, default: 'INBOX' },
});
const emit = defineEmits(['select', 'logout']);
const scrollRef = ref(null);
const contentRef = ref(null);
useLenisContainer(scrollRef, contentRef, { duration: 0.62 });

function folderIcon(folder) {
  return {
    '\\Inbox': Inbox,
    '\\Sent': Send,
    '\\Drafts': FileText,
    '\\Trash': Trash2,
    '\\Junk': ShieldAlert,
    '\\Archive': Archive,
    '\\Flagged': Star,
  }[folder.specialUse] || Folder;
}
</script>

<template>
  <aside class="mail-sidebar">
    <div ref="scrollRef" class="folder-scroll">
      <div ref="contentRef" class="folder-scroll__content">
        <nav class="folder-menu" aria-label="邮箱文件夹">
          <button
            v-for="folder in mailboxes"
            :key="folder.path"
            type="button"
            class="folder-menu__item"
            :class="{ 'is-active': folder.path === activeMailbox }"
            @click="emit('select', folder.path)"
          >
            <component :is="folderIcon(folder)" :size="18" />
            <span>{{ folder.label }}</span>
            <b v-if="folder.unseen">{{ folder.unseen > 99 ? '99+' : folder.unseen }}</b>
          </button>
        </nav>
        <div v-if="!mailboxes.length" class="folder-skeleton" aria-label="正在读取文件夹">
          <i v-for="item in 5" :key="item"></i>
        </div>
      </div>
    </div>

    <footer class="sidebar-footer">
      <button type="button" class="logout-button" @click="emit('logout')">
        <LogOut :size="17" /> 退出当前邮箱
      </button>
      <small>IMAP TLS 安全连接</small>
    </footer>
  </aside>
</template>
