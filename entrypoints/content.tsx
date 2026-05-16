import '@/assets/tailwind.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';

import ChatGptFloatingUi from '@/src/content/ChatGptFloatingUi';
import { installNativeHoverWarmup } from '@/src/content/chatgptDom';
import { editMessage, fetchNavigatorSnapshot, navigateToNode, submitReply } from '@/src/content/chatgptContentApi';
import type { ApiResult, ChatGptContentRequest, NavigatorSnapshot } from '@/src/shared/types';

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail(error: unknown): ApiResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    installNativeHoverWarmup();

    browser.runtime.onMessage.addListener((message: ChatGptContentRequest) => {
      if (!message || typeof message !== 'object' || !('type' in message)) return undefined;

      if (message.type === 'LLM_NAV_GET_TREE') {
        return fetchNavigatorSnapshot().then(ok<NavigatorSnapshot>).catch(fail);
      }
      if (message.type === 'LLM_NAV_NAVIGATE_TO_NODE') {
        return navigateToNode(message.nodeId).then(() => ok(true)).catch(fail);
      }
      if (message.type === 'LLM_NAV_EDIT_MESSAGE') {
        return editMessage(message.nodeId, message.text).then(() => ok(true)).catch(fail);
      }
      if (message.type === 'LLM_NAV_SUBMIT_REPLY') {
        return submitReply(message.parentNodeId, message.text).then(() => ok(true)).catch(fail);
      }

      return undefined;
    });

    const ui = await createShadowRootUi(ctx, {
      name: 'llm-chat-navigator',
      position: 'inline',
      anchor: 'body',
      isolateEvents: true,

      onMount(container) {
        const rootElement = document.createElement('div');
        rootElement.id = 'llm-chat-navigator-root';
        container.append(rootElement);

        const root = ReactDOM.createRoot(rootElement);
        root.render(
          <React.StrictMode>
            <ChatGptFloatingUi />
          </React.StrictMode>,
        );

        return root;
      },

      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
