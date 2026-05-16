# Codebase Summary

This WXT project now implements a ChatGPT-only conversation-tree navigator inspired by the uploaded reference extension.

## Entry points

- `entrypoints/background.ts`
  - Installs a `webRequest.onBeforeSendHeaders` listener for `https://chatgpt.com/backend-api/*`.
  - Stores captured request headers containing `Authorization` in `storage.session`, with `storage.local` fallback.
  - Handles `LLM_NAV_FETCH_CHATGPT_CONVERSATION` messages and fetches `https://chatgpt.com/backend-api/conversation/{conversationId}`.

- `entrypoints/content.tsx`
  - Runs on ChatGPT origins.
  - Warms up message-row hover controls by dispatching native-like mouse/pointer events.
  - Registers content-script message handlers for tree fetch, navigation, edit, and branch reply.
  - Mounts `ChatGptFloatingUi` inside a WXT Shadow DOM UI container.

## Shared model

- `src/shared/types.ts` defines the normalized `ConversationTree`, `ConversationNode`, `BranchStep`, and message types.
- `src/shared/chatgptTree.ts` extracts conversation IDs, parses ChatGPT raw messages, normalizes the mapping graph, computes current/target paths, and derives branch-navigation steps.

## ChatGPT DOM adapter

- `src/content/chatgptDom.ts` contains the ChatGPT-specific DOM selectors and actions ported from the reference extension:
  - node lookup via `[data-message-id="..."]`
  - branch control clicks using the same button-index strategy
  - edit/resubmit through the visible textarea flow
  - reply branching by editing one of the visible child messages

## UI

- `src/ui/ConversationNavigator.tsx` is provider-agnostic React UI.
- `src/content/ChatGptFloatingUi.tsx` supplies a draggable floating button/panel wrapper and passes direct content APIs to the navigator.
