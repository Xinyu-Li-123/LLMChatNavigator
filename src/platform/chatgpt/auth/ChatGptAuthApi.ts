import type { AuthApi } from '@/src/auth/AuthApi';
import type { AuthFetchRequestPayload, AuthFetchResponse, SupportedPlatform } from '@/src/auth/types';
import { ensure } from '@/src/utils';

type StoredHeader = { name: string; value?: string };

const CHATGPT_AUTH_REQUEST_PATTERN = 'https://chatgpt.com/backend-api/conversation/*';
const STORAGE_HEADERS_KEY = 'llmNavChatGptRequestHeaders';

function ensureAllowedChatGptUrl(urlText: string): void {
  const url = new URL(urlText);
  const allowedOrigin = url.origin === 'https://chatgpt.com' || url.origin === 'https://chat.openai.com';

  ensure(
    allowedOrigin && url.pathname.startsWith('/backend-api/'),
    `ChatGPT auth fetch does not support URL: ${urlText}`,
  );
}

function getHeaderStorage() {
  return 'session' in browser.storage && browser.storage.session
    ? browser.storage.session
    : browser.storage.local;
}

/**
 * Save header in browser session / local storage.
 *
 * We rely on browser storage to save header instead of saving it in an object in-memory.
 * This is because in MV3, the background script is executed in a service worker 
 * that may be terminated after inactivity
 */
async function saveHeaders(headers: StoredHeader[]): Promise<void> {
  await getHeaderStorage().set({ [STORAGE_HEADERS_KEY]: headers });
}

async function loadHeaders(): Promise<StoredHeader[] | null> {
  const result = await getHeaderStorage().get(STORAGE_HEADERS_KEY);
  return (result[STORAGE_HEADERS_KEY] as StoredHeader[] | undefined) ?? null;
}

function hasAuthorization(headers: StoredHeader[] | undefined): headers is StoredHeader[] {
  return Boolean(headers?.some((header) => header.name.toLowerCase() === 'authorization'));
}

async function waitForCapturedHeaders(maxAttempts: number = 4, delayMs: number = 400): Promise<StoredHeader[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const headers = await loadHeaders();
    if (hasAuthorization(headers)) return headers;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('No ChatGPT Authorization header captured yet. Refresh the ChatGPT tab, then open the navigator again.');
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

async function readResponseData(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class ChatGptAuthApi implements AuthApi {
  readonly platform: SupportedPlatform = 'chatgpt';

  init(): void {
    const listener = (details: { requestHeaders?: StoredHeader[] }) => {
      const headers = details.requestHeaders;
      if (hasAuthorization(headers)) {
        void saveHeaders(headers);
      }
    };

    try {
      browser.webRequest.onSendHeaders.addListener(
        listener,
        { urls: [CHATGPT_AUTH_REQUEST_PATTERN] },
        ['requestHeaders', 'extraHeaders'],
      );
    } catch (error) {
      try {
        browser.webRequest.onSendHeaders.addListener(
          listener,
          { urls: [CHATGPT_AUTH_REQUEST_PATTERN] },
          ['requestHeaders'],
        );
      } catch (fallbackError) {
        console.warn('LLM Chat Navigator: could not install ChatGPT header capture listener.', error, fallbackError);
      }
    }
  }

  async authFetch(payload: AuthFetchRequestPayload): Promise<AuthFetchResponse> {
    ensureAllowedChatGptUrl(payload.url);

    const storedHeaders = await waitForCapturedHeaders();
    const headers = new Headers(payload.headers);

    for (const header of storedHeaders) {
      if (header.value !== undefined) headers.set(header.name, header.value);
    }

    const response = await fetch(payload.url, {
      method: payload.method ?? 'GET',
      headers,
      body: payload.body ?? undefined,
      credentials: payload.credentials ?? 'include',
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
      data: await readResponseData(response),
    };
  }
}
