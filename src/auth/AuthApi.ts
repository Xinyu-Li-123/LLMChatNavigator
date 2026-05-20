import type { AuthFetchRequestPayload, AuthFetchResponse, SupportedPlatform } from './types';

export interface AuthApi {
  readonly platform: SupportedPlatform;
  init(): void;
  authFetch(payload: AuthFetchRequestPayload): Promise<AuthFetchResponse>;
}
