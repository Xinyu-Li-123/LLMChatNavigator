# LLM Chat Navigator

A WXT + React + TypeScript browser extension that adds a ChatGPT conversation-tree navigator.

## Implemented scope

- ChatGPT only for now (`https://chatgpt.com/*` and `https://chat.openai.com/*`).
- Captures ChatGPT `Authorization` request headers from normal `/backend-api/*` traffic, modeled after the reference extension.
- Fetches `/backend-api/conversation/{conversationId}` from the background script.
- Normalizes ChatGPT's `mapping` graph into an extension-owned `ConversationTree` model.
- Displays the tree in a draggable Shadow DOM floating panel on ChatGPT pages.
- Supports node search, current-path highlighting, branch-count badges, click-to-navigate, edit, and branch-reply-by-editing-visible-child.

## Development

```bash
pnpm install
pnpm dev
```

For Firefox:

```bash
pnpm dev:firefox
```

## Architecture

```text
entrypoints/background.ts
  Captures ChatGPT backend request headers and fetches raw conversation JSON.

entrypoints/content.tsx
  Mounts the floating React UI and exposes content-script message handlers.

src/shared/
  Provider-neutral types and ChatGPT tree normalization/path logic.

src/content/
  ChatGPT DOM adapter and content-script API.

src/ui/
  Provider-agnostic React tree navigator UI.
```

## Notes

The ChatGPT backend endpoint and DOM selectors are private/unsupported implementation details. If ChatGPT changes its UI or API, the adapter may need updates.
