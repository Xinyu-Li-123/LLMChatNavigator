// TODO: export type SupportedPlatform = 'chatgpt' | 'claude' | 'deepseek';
export type SupportedPlatform = 'chatgpt';

export type AuthFetchRequestPayload = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  credentials?: RequestCredentials;
};

export type AuthFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
};

export type AuthFetchBackgroundRequest = {
  type: 'LLM_NAV_AUTH_FETCH';
  platform: SupportedPlatform;
  payload: AuthFetchRequestPayload;
};
