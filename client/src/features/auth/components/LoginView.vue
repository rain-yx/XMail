<script setup>
import { computed, ref } from 'vue';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, TriangleAlert } from 'lucide-vue-next';
import { api } from '@/shared/api/xmail-api.js';
import { useLenisContainer } from '@/shared/composables/useLenisContainer.js';

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
      <div class="login-stage">
        <div class="login-card">
          <header class="login-card__header">
            <div class="login-card-title">
              <span><Mail :size="17" /></span>
              <div><b>{{ title }}</b><small>{{ domainHint }}</small></div>
            </div>
          </header>

          <div class="login-card__body">
            <div v-if="error" class="form-alert" role="alert">
              <TriangleAlert :size="16" /><span>{{ error }}</span>
            </div>

            <form class="login-form" @submit.prevent="submit">
              <label class="form-field">
                <span>邮箱地址</span>
                <span class="native-input">
                  <Mail :size="16" />
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
                  <KeyRound :size="16" />
                  <input
                    v-model="authorizationCode"
                    :type="showCode ? 'text' : 'password'"
                    autocomplete="current-password"
                    placeholder="请输入授权码"
                    minlength="6"
                    required
                  />
                  <button type="button" class="input-action" :aria-label="showCode ? '隐藏授权码' : '显示授权码'" @click="showCode = !showCode">
                    <EyeOff v-if="showCode" :size="16" /><Eye v-else :size="16" />
                  </button>
                </span>
              </label>

              <button class="primary-button login-submit" type="submit" :disabled="loading || !email || authorizationCode.length < 6">
                <span v-if="loading" class="native-spinner native-spinner--light"></span>
                <template v-else>登录 <ArrowRight :size="16" /></template>
              </button>
            </form>
          </div>
        </div>
      </div>

      <footer class="login-bottom-help">
        <details class="login-help">
          <summary>如何获取客户端授权码？</summary>
          <ol>
            <li>登录{{ title }}网页端并进入账号或邮箱设置。</li>
            <li>开启 IMAP 服务，按页面提示生成客户端授权码。</li>
            <li>填写生成的授权码，不要使用网页登录密码。</li>
          </ol>
        </details>
        <p class="login-expiry"><LockKeyhole :size="13" /> 登录状态持续保留，直到主动退出</p>
      </footer>
    </div>
  </section>
</template>

<style scoped src="./LoginView.css"></style>
