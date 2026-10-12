<script setup>
import { Bell, BellOff } from 'lucide-vue-next';

defineProps({
  supported: { type: Boolean, required: true },
  enabled: { type: Boolean, required: true },
});
defineEmits(['toggle']);
</script>

<template>
  <button
    type="button"
    class="notification-toggle"
    :class="{ 'is-enabled': enabled }"
    :disabled="!supported"
    :title="supported
      ? (enabled ? '关闭新邮件桌面提醒' : '开启新邮件桌面提醒')
      : '当前浏览器不支持桌面通知'"
    @click="$emit('toggle')"
  >
    <Bell v-if="enabled" :size="16" />
    <BellOff v-else :size="16" />
    <span>{{ enabled ? '新邮件提醒已开启' : '开启新邮件提醒' }}</span>
  </button>
</template>

<style scoped src="./NotificationToggle.css"></style>
