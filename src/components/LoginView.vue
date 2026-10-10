<script setup>
import { computed, ref } from 'vue';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from 'lucide-vue-next';
import { api } from '../api.js';
import { useLenisContainer } from '../useLenis.js';

const props = defineProps({
  family: { type: String, required: true },
  title: { type: String, required: true },
});
const emit = defineEmits(['logged-in']);
const email = ref('');
const authorizationCode = ref('');
const showCode = ref(false);
const loading = ref(false);
const error = ref('');
const scrollRef = ref(null);
const contentRef = ref(null);

useLenisContainer(scrollRef, contentRef);

const isNetease = computed(() => props.family === 'netease');
const domainHint = computed(() => isNetease.value
  ? '@163.com / @126.com / @yeah.net'
  : '@qq.com / @foxmail.com');
const emailPlaceholder = computed(() => isNetease.value ? 'name@163.com' : 'name@qq.com');
const brandClass = computed(() => isNetease.value ? 'provider-logo--netease' : 'provider-logo--qq');

async function submit() {
  if (loading.value || !email.value || authorizationCode.value.length < 6) return;
  error.value = '';
  loading.value = true;
  try {
    const result = await api.login(props.family, email.value, authorizationCode.value);
    authorizationCode.value = '';
    emit('logged-in', result.account);
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section ref="scrollRef" class="tab-login">
    <div ref="contentRef" class="tab-login__content">
      <div class="login-intro">
        <span class="provider-logo" :class="brandClass">{{ isNetease ? '易' : 'Q' }}</span>
        <p>CONNECT ACCOUNT</p>
        <h1>登录{{ title }}</h1>
        <p>在当前标签内连接邮箱。登录后，这里会直接切换为该账号的收件箱。</p>
        <div class="login-security">
          <ShieldCheck :size="19" />
          <span><b>隐私优先</b>授权码只保留在当前 Node.js 进程内存中，退出或重启即清除。</span>
        </div>
      </div>

      <div class="login-card">
        <header class="login-card__header">
          <div class="login-card-title">
            <span><Mail :size="18" /></span>
            <div><b>{{ title }}</b><small>{{ domainHint }}</small></div>
          </div>
        </header>

        <div class="login-card__body">
          <div v-if="error" class="form-alert" role="alert">
            <TriangleAlert :size="18" /><span>{{ error }}</span>
          </div>

          <form class="login-form" @submit.prevent="submit">
            <label class="form-field">
              <span>邮箱地址</span>
              <span class="native-input">
                <Mail :size="17" />
                <input
                  v-model.trim="email"
                  type="email"
                  autocomplete="username"
                  :placeholder="emailPlaceholder"
                  required
                />
              </span>
            </label>

            <label class="form-field">
              <span>客户端授权码</span>
              <span class="native-input">
                <KeyRound :size="17" />
                <input
                  v-model="authorizationCode"
                  :type="showCode ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="不是邮箱网页登录密码"
                  minlength="6"
                  required
                />
                <button type="button" class="input-action" :aria-label="showCode ? '隐藏授权码' : '显示授权码'" @click="showCode = !showCode">
                  <EyeOff v-if="showCode" :size="17" /><Eye v-else :size="17" />
                </button>
              </span>
            </label>

            <button class="primary-button login-submit" type="submit" :disabled="loading || !email || authorizationCode.length < 6">
              <span v-if="loading" class="native-spinner native-spinner--light"></span>
              <template v-else>连接邮箱 <ArrowRight :size="17" /></template>
            </button>
          </form>

          <details class="login-help">
            <summary>如何获取客户端授权码？</summary>
            <ol>
              <li>登录{{ title }}网页端并进入账号或邮箱设置。</li>
              <li>开启 IMAP 服务，按页面提示生成客户端授权码。</li>
              <li>在上方填写授权码，不要填写网页登录密码。</li>
            </ol>
          </details>
          <p class="login-expiry"><LockKeyhole :size="14" /> 登录最长保留 24 小时</p>
        </div>
      </div>
    </div>
  </section>
</template>
