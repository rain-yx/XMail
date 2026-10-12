import { ref } from 'vue';
import { api } from '@/shared/api/xmail-api.js';
import { notify } from '@/shared/ui/toast/toast-store.js';
import { normalizeAggregationSubject, sortMessagesNewestFirst } from '../lib/message-utils.js';

export function useAggregation(account, state, handleRequestError) {
  const aggregationTarget = ref(null);
  const aggregationBusy = ref(false);

  function showAggregationDialog(message) {
    aggregationTarget.value = message;
  }

  function applyOptimisticAggregation(message, rule) {
    const matchesRule = (item) => {
      if (item.kind === 'group') return false;
      if (rule.type === 'sender') {
        return item.from?.some((address) => (
          String(address?.address || '').trim().toLocaleLowerCase() === rule.value
        ));
      }
      return normalizeAggregationSubject(item.subject) === rule.value;
    };
    const matched = state.messages.value.filter(matchesRule);
    if (!matched.length) matched.push(message);
    const matchedUids = new Set(matched.map((item) => item.uid));
    const latest = sortMessagesNewestFirst(matched)[0];
    const unread = matched.reduce((count, item) => count + (item.seen ? 0 : 1), 0);
    const group = {
      kind: 'group',
      key: `group:${rule.id}`,
      groupId: rule.id,
      ruleId: rule.id,
      groupType: rule.type,
      label: rule.label,
      count: matched.length,
      unread,
      seen: unread === 0,
      flagged: matched.some((item) => item.flagged),
      date: latest.date,
      latestUid: latest.uid,
      latestSubject: latest.subject,
      subject: rule.label,
      from: latest.from,
      to: latest.to,
    };
    state.messages.value = sortMessagesNewestFirst([
      ...state.messages.value.filter((item) => !matchedUids.has(item.uid)),
      group,
    ]);
    state.total.value = Math.max(
      state.messages.value.length,
      state.total.value - Math.max(0, matched.length - 1),
    );
    state.unfilteredMessages.value = state.messages.value;
    state.selected.value = new Set();
  }

  async function createAggregation(type, target = aggregationTarget.value) {
    const message = target;
    if (!message || aggregationBusy.value) return;

    const sender = message.from?.[0];
    const value = type === 'sender' ? sender?.address : message.subject;
    const label = type === 'sender' ? (sender?.name || sender?.address) : message.subject;
    if (!value) {
      notify(
        type === 'sender' ? '这封邮件没有可用的发件人地址' : '这封邮件没有可用的主题',
        'error',
      );
      return;
    }

    aggregationBusy.value = true;
    try {
      const result = await api.createAggregationRule(account.id, {
        type,
        value,
        label,
        mailbox: state.activeMailbox.value,
        uid: message.uid,
      });
      const canUpdateImmediately = !state.query.value.trim() && !state.activeGroup.value;
      aggregationTarget.value = null;
      state.activeGroup.value = null;
      state.query.value = '';
      if (canUpdateImmediately) {
        applyOptimisticAggregation(message, result.rule);
        state.loadFirstPage({ silent: true });
      } else {
        state.unfilteredMessages.value = [];
        await state.loadFirstPage();
      }
      notify(result.created ? '聚合规则已创建' : '该聚合规则已经存在');
    } catch (error) {
      handleRequestError(error);
    } finally {
      aggregationBusy.value = false;
    }
  }

  function createAggregationFromMenu(message, type) {
    createAggregation(type, message);
  }

  async function removeGroup(group) {
    try {
      await api.deleteAggregationRule(account.id, group.ruleId);
      if (state.activeGroup.value?.ruleId === group.ruleId) state.activeGroup.value = null;
      await state.loadFirstPage();
      notify('已取消聚合');
    } catch (error) {
      handleRequestError(error);
    }
  }

  return {
    aggregationTarget,
    aggregationBusy,
    showAggregationDialog,
    createAggregation,
    createAggregationFromMenu,
    removeGroup,
  };
}
