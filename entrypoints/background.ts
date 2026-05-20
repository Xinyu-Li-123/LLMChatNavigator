import type { AuthApi } from '@/src/auth/AuthApi';
import type { AuthFetchBackgroundRequest, AuthFetchResponse, SupportedPlatform } from '@/src/auth/types';
import { ChatGptAuthApi } from '@/src/platform/chatgpt/auth/ChatGptAuthApi';
import type { ApiResult } from '@/src/shared/types';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail(error: unknown): ApiResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function isAuthFetchBackgroundRequest(message: unknown): message is AuthFetchBackgroundRequest {
  if (!message || typeof message !== 'object') return false;

  const candidate = message as Record<string, unknown>;
  const payload = candidate.payload;

  return (
    candidate.type === 'LLM_NAV_AUTH_FETCH' &&
    typeof candidate.platform === 'string' &&
    payload !== null &&
    typeof payload === 'object' &&
    typeof (payload as Record<string, unknown>).url === 'string'
  );
}

function buildAuthApiMap(): Map<SupportedPlatform, AuthApi> {
  const authApis: AuthApi[] = [
    new ChatGptAuthApi(),
  ];

  return new Map(authApis.map((authApi) => [authApi.platform, authApi] as const));
}

export default defineBackground(() => {
  const authApis = buildAuthApiMap();

  // We can't just choose an authApi based on url, because the url is not known to background script 
  // until the first message is sent. If we send an init message in our extension, we have the risk of 
  // registering the listener later than user clicking nav ui, leading to race condition.
  for (const authApi of authApis.values()) {
    authApi.init();
  }

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isAuthFetchBackgroundRequest(message)) return undefined;

    const authApi = authApis.get(message.platform);
    if (!authApi) {
      return Promise.resolve(fail(`Unsupported platform: ${message.platform}`));
    }

    return authApi
      .authFetch(message.payload)
      .then(ok<AuthFetchResponse>)
      .catch(fail);
  });
});
