<script setup>
import { computed, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import {
  ChevronDown,
  Download,
  File,
  ImageOff,
  Paperclip,
  X,
} from 'lucide-vue-next';
import { api } from '@/shared/api/xmail-api.js';
import { useLenisContainer } from '@/shared/composables/useLenisContainer.js';

const props = defineProps({
  accountId: { type: String, required: true },
  message: { type: Object, default: null },
  loading: Boolean,
  mailbox: { type: String, default: 'INBOX' },
});
const emit = defineEmits(['close']);
const showRemoteImages = ref(false);
const showRecipients = ref(true);
const visible = ref(true);
const scrollRef = ref(null);
const contentRef = ref(null);
const lenis = useLenisContainer(scrollRef, contentRef);

watch(() => props.message?.uid, () => {
  showRemoteImages.value = false;
  showRecipients.value = true;
  lenis.scrollTo(0, { immediate: true });
});

function requestClose() {
  visible.value = false;
}

const renderedHtml = computed(() => {
  if (!props.message?.html) return '';
  const sanitized = DOMPurify.sanitize(props.message.html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'link', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['srcset'],
  });
  const document = new DOMParser().parseFromString(sanitized, 'text/html');
  for (const link of document.querySelectorAll('a')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  for (const image of document.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    if (/^cid:/i.test(source)) {
      const contentId = source.slice(4).replace(/^<|>$/g, '');
      const attachment = props.message.attachments?.find(
        (item) => item.contentId?.replace(/^<|>$/g, '') === contentId,
      );
      if (attachment) {
        image.setAttribute('src', api.attachmentUrl(
          props.accountId,
          props.mailbox,
          props.message.uid,
          attachment.id,
        ));
      } else image.removeAttribute('src');
    } else if (/^https?:\/\//i.test(source) && !showRemoteImages.value) {
      image.removeAttribute('src');
      image.setAttribute('alt', image.getAttribute('alt') || '[远程图片已隐藏]');
      image.classList.add('xmail-blocked-image');
    }
  }
  for (const element of document.querySelectorAll('[style], [background]')) {
    const style = element.getAttribute('style') || '';
    const background = element.getAttribute('background') || '';
    if (/url\s*\([^)]*https?:\/\//i.test(style)) element.removeAttribute('style');
    if (/^https?:\/\//i.test(background)) element.removeAttribute('background');
  }
  return document.body.innerHTML;
});

const hasBlockedImages = computed(() =>
  Boolean(props.message?.html && /<img[^>]+src=["']https?:\/\//i.test(props.message.html)),
);

function addressLabel(address) {
  if (!address) return '未知发件人';
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function addressList(list) {
  return list?.map(addressLabel).join('、') || '无';
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer" appear @after-leave="emit('close')">
      <div v-if="visible" class="detail-layer">
        <div class="detail-scrim" @click="requestClose"></div>
        <aside class="message-detail" aria-label="邮件详情">
          <div class="detail-toolbar">
            <button class="square-control" type="button" aria-label="关闭" @click="requestClose"><X :size="20" /></button>
          </div>

          <div v-if="loading" class="detail-loading">
            <span class="native-spinner"></span><span>正在读取邮件</span>
          </div>

          <div v-else-if="message" ref="scrollRef" class="detail-scroll">
            <article ref="contentRef" class="detail-content">
              <div class="detail-heading">
                <h2>{{ message.subject || '（无主题）' }}</h2>
              </div>

              <div class="sender-block">
                <div class="sender-detail">
                  <strong>{{ message.from?.[0]?.name || message.from?.[0]?.address || '未知发件人' }}</strong>
                  <button type="button" class="link-button" @click="showRecipients = !showRecipients">
                    收件信息 <ChevronDown :size="13" :class="{ 'rotate-180': showRecipients }" />
                  </button>
                </div>
                <time>{{ formatFullDate(message.date) }}</time>
              </div>

              <dl v-if="showRecipients" class="recipient-details">
                <div><dt>发件人</dt><dd>{{ addressList(message.from) }}</dd></div>
                <div><dt>收件人</dt><dd>{{ addressList(message.to) }}</dd></div>
                <div v-if="message.cc?.length"><dt>抄送</dt><dd>{{ addressList(message.cc) }}</dd></div>
              </dl>

              <div v-if="hasBlockedImages && !showRemoteImages" class="remote-image-alert">
                <ImageOff :size="17" />
                <span>已隐藏远程图片以保护隐私</span>
                <button type="button" class="link-button" @click="showRemoteImages = true">显示图片</button>
              </div>

              <div v-if="renderedHtml" class="mail-body mail-body--html" v-html="renderedHtml"></div>
              <pre v-else class="mail-body mail-body--text">{{ message.text || '这封邮件没有可显示的正文。' }}</pre>

              <section v-if="message.attachments?.length" class="attachments">
                <h3><Paperclip :size="17" /> {{ message.attachments.length }} 个附件</h3>
                <div class="attachment-grid">
                  <a
                    v-for="attachment in message.attachments"
                    :key="attachment.id"
                    class="attachment-card"
                    :href="api.attachmentUrl(accountId, mailbox, message.uid, attachment.id)"
                    target="_blank"
                    rel="noopener"
                    download
                  >
                    <span class="attachment-icon"><File :size="22" /></span>
                    <span><strong>{{ attachment.filename }}</strong><small>{{ formatBytes(attachment.size) }}</small></span>
                    <Download :size="17" />
                  </a>
                </div>
              </section>
            </article>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="./MessageDetail.css"></style>
