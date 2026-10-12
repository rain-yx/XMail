export class ApiRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function request(path, options = {}, accountId = '') {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accountId ? { 'X-XMail-Account-Id': accountId } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.error?.message || '请求失败，请稍后重试。',
      response.status,
      payload?.error?.code || 'REQUEST_FAILED',
    );
  }
  return payload;
}
