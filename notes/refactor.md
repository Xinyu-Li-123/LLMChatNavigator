# Plan for Refactor

## TODO List of Unsure Items

- [ ] Who should own the authoritative tree repr of chat? Is it the convo controller or the page ui or some intermediate class (e.g. `Convo`) that lives in content script?

## Current Plan

### Background Script

We will let background script provide a minimal set of privileged operations. For now, background script should only proxy fetch request by adding a platform-specific auth header, with a msg type of `LLM_NAV_AUTH_FETCH`. It should not handle complex platform-specific logic like "send request to backend to fetch convo".

For auth fetch support, we will define an interface for auth fetch support

```typescript
type SupportedPlatform = "chatgpt" | "claude" | "deepseek";

// We can also add headers that are modifiable by content script
type FetchRequestPayload = object;

// This can be converted to platform-specific response inside platform convo controller
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

### Convo Controller in Content Script

First, we can have some abstractions

```typescript
export type ConvoMetadata = {
  convoId: string;
  convoTitle: string;
  convoUrl: string;
};

export interface ConvoSnapshot {
  readonly convoMetadata: ConvoMetadata;
  readonly curNodeId: string;
  readonly tree: ConvoTree;
}
```

Based on how the nav ui page is refreshed, we have a simple and complex way to define the Convo Controller interface

#### Simplest way: only support manual refreshing

We will define a platform-agnostic interface `ConvoController` (Conversation Controller), which provides methods to

- serve an authoritative tree repr of convo history

- fetch convo history from backend to update the internal convo tree repr

- interact with DOM tree to switch branch and navigate to message

- interact with DOM tree to submit reply at a message

```typescript
export interface ConvoController {
  readonly platformName: SupportedPlatforms;

  /**
   * Get latest known authoritative convo, or null if no snapshot is fetched yet
   */
  getSnapshot(): ConvoSnapshot | null;

  /**
   * Consult backend server to refresh convo to be latest
   */
  syncConvo(): Promise<void>;

  /**
   * Navigate to a node, scroll to it and switch branch if necessary
   */
  navigateToNode(targetNodeId: string): Promise<void>;

  // NOTE: Why no editMsg interface?
  // Message editing can happen inside the nav ui without touching the webpage.
  // Thus, we don't need an api to edit message, and only need to
  // submit the edited message to backend

  /**
   * Edit a node's message and submit to backend.
   */
  submitReply(parentNodeId: string, text: string): Promise<void>;
}
```

We will implement this interface for each platform, e.g. For ChatGPT, we have

```typescript
class ChatGPTConvoController implements ConvoController {
  // ...
}
```

The `ChatGPTConvoController` will fetch convo from backend, parse the response, use it to update its internal repr of convo tree, and return the platform-agnostic convo tree repr.

#### Complex but better way: Convo Controller provide a subscribe method from which nav ui can register event listener

Nav UI will be updated immediately

```typescript
export interface ConvoController {
  readonly platformName: SupportedPlatforms;

  /**
   * Get latest known authoritative convo, or null if no snapshot is fetched yet
   */
  getSnapshot(): ConvoSnapshot | null;

  /**
   * Consult backend server to refresh convo to be latest
   */
  syncConvo(): Promise<void>;

  /**
   * Navigate to a node, scroll to it and switch branch if necessary
   */
  navigateToNode(targetNodeId: string): Promise<void>;

  /**
   * Edit a node's message and submit to backend.
   */
  submitReply(parentNodeId: string, text: string): Promise<void>;

  /**
   * Register a listener that is triggered on snapshot update
   *
   * Note that a new snapshot will always be fetched on syncConv().
   * But if it is the same as the current snapshot, this listener won't be called.
   */
  subscribe(listener: (snapshot: ConvoSnapshot) => void): () => void;
}
```

While there could be many reasons for a snapshot to change, these reasons are irrelavent to the nav ui. The nav ui only needs to know that "old snapshot has changed into a new snapshot".

The platform-specific convo controller impl will be responsible for detecting various types of event, including

- user switch branch by clicking button

  Mutation observer

- user submit new message

  Mutation observer

- user edit an existing message

  Mutation observer

- user change convo url (click another convo)

  We can use a mutation observer that observes the entire document, and check current `location.href` with previous url, to detect url change within a SPA.

  ```typescript
  // Source - https://stackoverflow.com/a/67825703
  // Posted by d-_-b, modified by community. See post 'Timeline' for change history
  // Retrieved 2026-05-20, License - CC BY-SA 4.0
  let previousUrl = "";
  const observer = new MutationObserver(function (mutations) {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      console.log(`URL changed to ${location.href}`);
    }
  });
  const config = { subtree: true, childList: true };
  observer.observe(document, config);
  ```

### Platform-agnostic Nav UI

We will initialize an instance of convo controller in content script, and pass it to our LLM Chat Navigator UI as prop. This way, we can define the UI in a platform-agnostic way.

Later, if we want to mount the UI to a popup window, we may need to wrap the convo controller in an instance that send message to content script, and pass that wrapped convo api to the nav ui as prop.
