import { computed, onMounted, ref, watchEffect } from 'vue';
import { api } from '@/shared/api/xmail-api.js';
import { notify } from '@/shared/ui/toast/toast-store.js';

const ACCOUNT_TABS = [
  { id: 'netease', family: 'netease', label: '网易邮箱', hint: '163 / 126 / Yeah' },
  { id: 'qq', family: 'qq', label: 'QQ 邮箱', hint: 'QQ / Foxmail' },
];

export function useAccountTabs() {
  const tabs = ref(ACCOUNT_TABS.map((tab) => ({
    ...tab,
    account: null,
    newMailCount: 0,
    inboxRequest: 0,
  })));
  const activeTab = ref('netease');
  const booting = ref(true);
  const currentTab = computed(() => tabs.value.find((tab) => tab.id === activeTab.value));
  const pendingNewMailCount = computed(() => (
    tabs.value.reduce((count, tab) => count + tab.newMailCount, 0)
  ));

  watchEffect(() => {
    const tab = currentTab.value;
    const badge = pendingNewMailCount.value ? `(${pendingNewMailCount.value}) ` : '';
    document.title = `${badge}XMail · ${tab?.account?.email || tab?.label || '邮箱'}`;
  });

  onMounted(restoreSession);

  async function restoreSession() {
    try {
      const result = await api.session();
      for (const account of result.accounts || []) {
        const tab = tabs.value.find((item) => item.family === account.family && !item.account);
        if (tab) tab.account = account;
      }
      const firstConnected = tabs.value.find((tab) => tab.account);
      if (firstConnected) activeTab.value = firstConnected.id;
    } catch (error) {
      if (error.status !== 401) notify(error.message || '读取登录状态失败', 'error');
    } finally {
      booting.value = false;
    }
  }

  function handleLogin(tab, account) {
    tab.account = account;
    tab.newMailCount = 0;
    notify(`${account.email} 已连接`);
  }

  function selectTab(tab) {
    const shouldOpenInbox = tab.newMailCount > 0 && tab.account;
    activeTab.value = tab.id;
    tab.newMailCount = 0;
    if (shouldOpenInbox) tab.inboxRequest += 1;
  }

  async function disconnect(tab, quiet = false) {
    const account = tab.account;
    if (!account) return;
    try {
      await api.removeAccount(account.id);
    } catch (error) {
      if (error.status !== 401 && error.status !== 404) {
        notify(error.message || '退出邮箱失败', 'error');
        return;
      }
    }
    tab.account = null;
    tab.newMailCount = 0;
    if (!quiet) notify('已退出该邮箱');
  }

  function handleSessionExpired(tab) {
    disconnect(tab, true);
    notify('邮箱登录已失效，请重新输入授权码', 'error');
  }

  return {
    tabs,
    activeTab,
    booting,
    selectTab,
    handleLogin,
    disconnect,
    handleSessionExpired,
  };
}
