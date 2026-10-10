<script setup>
import {onMounted, ref} from "vue";
import {Inbox, Mail, ShieldCheck} from "lucide-vue-next";
import {api} from "./api.js";
import {notify} from "./toast.js";
import AccountWorkspace from "./components/AccountWorkspace.vue";
import LoginView from "./components/LoginView.vue";
import ToastHost from "./components/ToastHost.vue";

const tabs = ref([
  {id: "netease", family: "netease", label: "网易邮箱", hint: "163 / 126 / Yeah", account: null},
  {id: "qq", family: "qq", label: "QQ 邮箱", hint: "QQ / Foxmail", account: null},
]);
const activeTab = ref("netease");
const booting = ref(true);

onMounted(async () => {
  try {
    const result = await api.session();
    for (const account of result.accounts || []) {
      const tab = tabs.value.find((item) => item.family === account.family && !item.account);
      if (tab) tab.account = account;
    }
    const firstConnected = tabs.value.find((tab) => tab.account);
    if (firstConnected) activeTab.value = firstConnected.id;
  } catch (error) {
    if (error.status !== 401) notify(error.message || "读取登录状态失败", "error");
  } finally {
    booting.value = false;
  }
});

function handleLogin(tab, account) {
  tab.account = account;
  notify(`${account.email} 已连接`);
}

async function disconnect(tab, quiet = false) {
  const account = tab.account;
  if (!account) return;
  try {
    await api.removeAccount(account.id);
  } catch (error) {
    if (error.status !== 401 && error.status !== 404) {
      notify(error.message || "退出邮箱失败", "error");
      return;
    }
  }
  tab.account = null;
  if (!quiet) notify("已退出该邮箱");
}

function handleSessionExpired(tab) {
  disconnect(tab, true);
  notify("邮箱登录已失效，请重新输入授权码", "error");
}
</script>

<template>
  <div v-if="booting" class="boot-screen">
    <span class="native-spinner" aria-label="正在打开 XMail"></span>
  </div>

  <div v-else class="app-shell">
    <header class="app-header">
      <div class="app-brand">
        <strong>XMail</strong>
      </div>
    </header>

    <section class="account-tabs">
      <div class="account-tabs__header" role="tablist" aria-label="邮箱账号">
        <button
          v-for="tab in tabs"
          :id="`tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          class="account-tab-button"
          :class="{'is-active': activeTab === tab.id}"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`panel-${tab.id}`"
          @click="activeTab = tab.id">
          <span class="account-tab-label">
            <i :class="{'is-online': tab.account}"></i>
            <span>{{ tab.account?.email || tab.hint }}</span>
          </span>
        </button>
      </div>

      <div class="account-tabs__content">
        <div
          v-for="tab in tabs"
          v-show="activeTab === tab.id"
          :id="`panel-${tab.id}`"
          :key="tab.id"
          class="account-tab-pane"
          role="tabpanel"
          :aria-labelledby="`tab-${tab.id}`">
          <AccountWorkspace
            v-if="tab.account"
            :key="tab.account.id"
            :account="tab.account"
            @disconnect="disconnect(tab)"
            @session-expired="handleSessionExpired(tab)" />
          <LoginView
            v-else
            :family="tab.family"
            :title="tab.label"
            @logged-in="handleLogin(tab, $event)" />
        </div>
      </div>
    </section>
  </div>
  <ToastHost />
</template>
