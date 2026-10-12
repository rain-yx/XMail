<script setup>
import { useAccountTabs } from './composables/useAccountTabs.js';
import LoginView from '@/features/auth/components/LoginView.vue';
import AccountWorkspace from '@/features/mail/components/AccountWorkspace.vue';
import NotificationToggle from '@/features/notifications/components/NotificationToggle.vue';
import { useDesktopNotifications } from '@/features/notifications/composables/useDesktopNotifications.js';
import ToastHost from '@/shared/ui/toast/ToastHost.vue';

const {
  tabs,
  activeTab,
  booting,
  selectTab,
  handleLogin,
  disconnect,
  handleSessionExpired,
} = useAccountTabs();
const notifications = useDesktopNotifications();

function handleNewMail(tab, payload) {
  notifications.announce(tab, payload, {
    activeTabId: activeTab.value,
    openTab: selectTab,
  });
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
      <NotificationToggle
        :supported="notifications.supported"
        :enabled="notifications.enabled.value"
        @toggle="notifications.toggle"
      />
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
          @click="selectTab(tab)">
          <span class="account-tab-label">
            <i :class="{'is-online': tab.account}"></i>
            <span>{{ tab.account?.email || tab.hint }}</span>
            <em v-if="tab.newMailCount" class="account-new-mail-badge">
              {{ tab.newMailCount > 99 ? '99+' : tab.newMailCount }}
            </em>
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
            :inbox-request="tab.inboxRequest"
            @disconnect="disconnect(tab)"
            @new-mail="handleNewMail(tab, $event)"
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

<style scoped src="./App.css"></style>
