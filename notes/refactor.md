# Plan for Refactor

## TODO List of Unsure Items

- [ ] Who should own the authoritative tree repr of chat? Is it the convo adaptor or the page ui or some intermediate class (e.g. `Convo`) that lives in content script?

## Current Plan

### Background Script

We will let background script provide a minimal set of privileged operations. For now, background script should only proxy fetch request by adding a platform-specific auth header, with a msg type of `LLM_NAV_AUTH_FETCH`. It should not handle complex platform-specific logic like "send request to backend to fetch convo".

For auth fetch support, we will define an interface for auth fetch support

```typescript
type SupportedPlatform = "chatgpt" | "claude" | "deepseek";

// We can also add headers that are modifiable by content script
type FetchRequestPayload = object;

// This can be converted to platform-specific response inside platform convo adaptor
type FetchResponse = object;

type AuthApi = {
  init(): () => void;
  authFetch(): (payload: FetchRequestData) => Promise<FetchResponse>;
};
```

We implement platform-specific logic for auth fetch support by implementing this interface `authAPI` in `src/platform/chatgpt/`.

```typescript
const chatGptAuthApi: AuthApi = {
  init: installAuthHeaderCapture();
  // authFetch: ...
}
```

This platform-specific auth api will be init in background script based on platform, and used inside listener. E.g.

```typescript
type LLMChatRequest = {
  type: "LLM_NAV_AUTH_FETCH";
  platform: SupportedPlatform;
  payload: object;
};

export default defineBackground(() => {
  // check platform, choose which authApi to initiate
  const authApi: AuthApi = buildAuthApi();
  authApi.init();

  browser.runtime.onMessage.addListener((message: LLMChatNavRequest) => {
    if (!message || typeof message !== "object" || !("type" in message))
      return undefined;

    if (message.type === "LLM_NAV_AUTH_FETCH") {
      ensure(
        message.platform === authApi.platform,
        `Mismatch platform between message (${message.platform}) and authApi (${authApi.platform})`,
      );

      return authApi
        .authFetch(message.payload)
        .then(ok<FetchResponse>)
        .catch(fail);
    }

    return undefined;
  });
});
```

### Convo Adaptor in Content Script

We will define a platform-agnostic interface `ConvoAdaptor` (Conversation Adaptor), which provides methods to

- fetch convo history from backend, parse it into platform-agnostic tree repr and return

- interact with DOM tree to switch branch and navigate to message

- interact with DOM tree to submit reply at a message

```typescript
export interface ConvoAdaptor {
  readonly platformName: SupportedPlatforms;
  readonly curNodeId: string;
  readonly convoId: string;

  fetchConvoAndSync(): Promise<ConvoTree>;
  navigateToNode(targetNodeId: string): Promise<void>;
  // Message editing can happen inside the nav ui without touching the webpage.
  // We only need to submit the edited message using submitReply.
  submitReply(parentNodeId: string, text: string): Promise<void>;
}
```

We will implement this interface for each platform, e.g. For ChatGPT, we have

```typescript
class ChatGPTConvoAdaptor implements ConvoAdaptor {
  // ...
}
```

The `ChatGPTConvoAdaptor` will fetch convo from backend, parse the response, use it to update its internal repr of convo tree, and return the platform-agnostic convo tree repr.

> TODO: This `ConvoAdaptor.fetchConvoAndSync()` is a bit overloaded. May need to reconsider what API the adaptor should provide.

### Platform-agnostic Nav UI

We will initialize an instance of convo adaptor in content script, and pass it to our LLM Chat Navigator UI as prop. This way, we can define the UI in a platform-agnostic way.

Later, if we want to mount the UI to a popup window, we may need to wrap the convo adaptor in an instance that send message to content script, and pass that wrapped convo api to the nav ui as prop.
