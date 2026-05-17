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
 * Install a listener that capture the request header that contains the authorization for backend api. Later, we can reuse this header to make request to backend.
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

async function waitForCapturedHeaders(): Promise<StoredHeader[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const headers = await loadHeaders();
    if (hasAuthorization(headers)) return headers;
    await new Promise((resolve) => setTimeout(resolve, 400));
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

    if (message.type === 'LLM_NAV_FETCH_CHATGPT_CONVERSATION') {
      return fetchChatGptConversation(message.conversationId).then(ok<ChatGptConversationResponse>).catch(fail);
    }

    if (message.type === 'LLM_NAV_GET_CAPTURE_STATUS') {
      return loadHeaders().then((headers) => ok({ hasAuthorization: hasAuthorization(headers ?? undefined) })).catch(fail);
    }

    return undefined;
  });
});
