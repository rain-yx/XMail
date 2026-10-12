const PROVIDERS = Object.freeze({
  '163.com': netease('163', '网易 163 邮箱', 'imap.163.com'),
  '126.com': netease('126', '网易 126 邮箱', 'imap.126.com'),
  'yeah.net': netease('yeah', '网易 Yeah 邮箱', 'imap.yeah.net'),
  'vip.163.com': netease('vip163', '163 VIP 邮箱', 'imap.vip.163.com'),
  'vip.126.com': netease('vip126', '126 VIP 邮箱', 'imap.vip.126.com'),
  '188.com': netease('188', '网易 188 邮箱', 'imap.188.com'),
  'qq.com': authorizationCode('qq', 'QQ 邮箱', 'imap.qq.com'),
  'foxmail.com': authorizationCode('foxmail', 'Foxmail 邮箱', 'imap.qq.com'),
});

function netease(id, label, host) {
  return { id, label, host, family: 'netease', credentialType: 'authorization-code' };
}

function authorizationCode(id, label, host) {
  return { id, label, host, family: 'qq', credentialType: 'authorization-code' };
}

export function getProvider(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(normalizedEmail)) return null;

  const [, domain] = normalizedEmail.split('@');
  const provider = PROVIDERS[domain];
  if (!provider) return null;

  return {
    ...provider,
    domain,
    email: normalizedEmail,
    authUser: normalizedEmail,
    port: 993,
    secure: true,
    authType: 'password',
  };
}

export function getPublicProviders() {
  return Object.entries(PROVIDERS).map(([domain, provider]) => ({
    domain,
    label: provider.label,
    family: provider.family,
    credentialType: provider.credentialType,
  }));
}

export const SUPPORTED_DOMAINS = Object.freeze(Object.keys(PROVIDERS));
