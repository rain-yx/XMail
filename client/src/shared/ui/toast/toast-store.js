import { reactive } from 'vue';

export const toasts = reactive([]);
let nextId = 1;

export function notify(message, type = 'success') {
  const id = nextId++;
  toasts.push({ id, message, type });
  window.setTimeout(() => removeToast(id), 3200);
}

export function removeToast(id) {
  const index = toasts.findIndex((item) => item.id === id);
  if (index >= 0) toasts.splice(index, 1);
}
