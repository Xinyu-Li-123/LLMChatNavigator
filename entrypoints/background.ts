// TODO: Refactor this whole background script into provide-agnostic and provider-specific parts

import type { ApiResult, ChatGptBackgroundRequest, ChatGptConversationResponse } from '@/src/shared/types';

type StoredHeader = { name: string; value?: string };

const CHATGPT_AUTH_REQUEST_PATTERN = 'https://chatgpt.com/backend-api/conversation/*';
const STORAGE_HEADERS_KEY = 'llmNavChatGptRequestHeaders';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail(error: unknown): ApiResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function getHeaderStorage() {
  return 'session' in browser.storage && browser.storage.session
    ? browser.storage.session
    : browser.storage.local;
}

async function saveHeaders(headers: StoredHeader[]): Promise<void> {
  await getHeaderStorage().set({ [STORAGE_HEADERS_KEY]: headers });
}

async function loadHeaders(): Promise<StoredHeader[] | null> {
  const result = await getHeaderStorage().get(STORAGE_HEADERS_KEY);
  return (result[STORAGE_HEADERS_KEY] as StoredHeader[] | undefined) ?? null;
}

function hasAuthorization(headers: StoredHeader[] | undefined): headers is StoredHeader[] {
  // Some TypeScript magic to let typechecker know headers is StoredHeader[] if 
  // this function returns true
  return Boolean(headers?.some((header) => header.name.toLowerCase() === 'authorization'));
}

/**
 * Install a listener that captures the request header that contains the authorization for backend api. Later, we can reuse this header to make request to backend.
 */
function installAuthHeaderCapture(): void {
  const listener = (details: { requestHeaders?: StoredHeader[] }) => {
    const headers = details.requestHeaders;
    if (hasAuthorization(headers)) {
      void saveHeaders(headers);
    }
  };

  try {
    // NOTE: We don't use onBeforeSendHeaders because Chrome doesn't provide authorization header in this event
    // See https://developer.chrome.com/docs/extensions/reference/api/webRequest#life_cycle_footnote
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

/** 
 * Wait for auth header to be captured. 
 *
 * @param maxAttempts - Max number of attempts we check if auth header is captured
 * @param delayMs - millisecond we wait between attempts
 */
async function waitForCapturedHeaders(maxAttempts: number = 4, delayMs: number = 400): Promise<StoredHeader[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const headers = await loadHeaders();
    if (hasAuthorization(headers)) return headers;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('No ChatGPT Authorization header captured yet. Refresh the ChatGPT tab, then open the navigator again.');
}

async function fetchChatGptConversation(conversationId: string): Promise<ChatGptConversationResponse> {
  const storedHeaders = await waitForCapturedHeaders();
  const headers = new Headers();

  for (const header of storedHeaders) {
    if (header.value !== undefined) headers.append(header.name, header.value);
  }

  const response = await fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`ChatGPT conversation fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ChatGptConversationResponse;
  if (!data?.mapping) throw new Error('ChatGPT API returned no conversation mapping.');
  return data;
}

export default defineBackground(() => {
  installAuthHeaderCapture();

  browser.runtime.onMessage.addListener((message: ChatGptBackgroundRequest) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return undefined;

    // TODO: Define a generic "auth fetch msg" message type, so content script can initiate any fetch request
    // with platform-specific authorization
    // To achieve this, we can 
    // - define an interface for auth fetch support, e.g. how to obtain latest auth header, and how to pack the header to a fetch request
    // - implement this support for each platform under some folder like src/<platform>/auth/
    if (message.type === 'LLM_NAV_FETCH_CHATGPT_CONVERSATION') {
      return fetchChatGptConversation(message.conversationId).then(ok<ChatGptConversationResponse>).catch(fail);
    }

    // TODO: Either use this msg type or remove this handler
    if (message.type === 'LLM_NAV_GET_CAPTURE_STATUS') {
      return loadHeaders().then((headers) => ok({ hasAuthorization: hasAuthorization(headers ?? undefined) })).catch(fail);
    }

    return undefined;
  });
});
