import { ref } from 'vue';
import { notify } from '@/shared/ui/toast/toast-store.js';

const REMINDER_STORAGE_KEY = 'xmail-new-mail-reminders';

export function useDesktopNotifications() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const enabled = ref(
    supported
    && Notification.permission === 'granted'
    && readPreference() !== 'off',
  );

  async function toggle() {
    if (!supported) {
      notify('当前浏览器不支持桌面通知', 'error');
      return;
    }
    if (enabled.value) {
      enabled.value = false;
      writePreference('off');
      notify('新邮件桌面提醒已关闭');
      return;
    }

    let permission = Notification.permission;
    try {
      if (permission === 'default') permission = await Notification.requestPermission();
    } catch {
      notify('无法请求桌面通知权限', 'error');
      return;
    }
    if (permission !== 'granted') {
      writePreference('off');
      notify('浏览器未允许通知，请在网站权限中开启', 'error');
      return;
    }

    enabled.value = true;
    writePreference('on');
    notify('新邮件桌面提醒已开启');
  }

  function announce(tab, payload, { activeTabId, openTab }) {
    const messages = payload?.messages || [];
    if (!messages.length) return;

    const latest = messages.at(-1);
    const sender = formatSender(latest);
    const subject = latest.subject || '(无主题)';
    const isCurrentAndVisible = activeTabId === tab.id
      && payload.inboxVisible
      && !document.hidden
      && document.hasFocus();
    if (!isCurrentAndVisible) tab.newMailCount += messages.length;

    notify(messages.length === 1
      ? `新邮件 · ${sender}：${subject}`
      : `${tab.account.email} 收到 ${messages.length} 封新邮件`);

    if (!enabled.value || Notification.permission !== 'granted' || isCurrentAndVisible) return;
    try {
      const notification = new Notification(
        messages.length === 1 ? subject : `${messages.length} 封新邮件`,
        {
          body: messages.length === 1 ? `${sender} · ${tab.account.email}` : tab.account.email,
          icon: '/favicon.ico',
          tag: `xmail-${tab.account.id}-${latest.uid}`,
        },
      );
      notification.onclick = () => {
        window.focus();
        openTab(tab);
        notification.close();
      };
    } catch {
      enabled.value = false;
    }
  }

  return { supported, enabled, toggle, announce };
}

function formatSender(message) {
  const sender = message?.from?.[0];
  return sender?.name || sender?.address || '未知发件人';
}

function readPreference() {
  try {
    return localStorage.getItem(REMINDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePreference(value) {
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, value);
  } catch {
    // The reminder still works for this page when storage is unavailable.
  }
}
