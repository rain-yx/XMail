<script setup>
import { CircleCheck, CircleX, X } from 'lucide-vue-next';
import { removeToast, toasts } from '../toast.js';
</script>

<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-stack">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast--${toast.type}`" role="status">
        <CircleX v-if="toast.type === 'error'" :size="18" />
        <CircleCheck v-else :size="18" />
        <span>{{ toast.message }}</span>
        <button type="button" aria-label="关闭提示" @click="removeToast(toast.id)"><X :size="15" /></button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>
