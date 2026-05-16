import '@/assets/tailwind.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';

import ChatGptFloatingUi from '@/src/content/ChatGptFloatingUi';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],

  // Critical: inject imported CSS into the WXT UI container,
  // not as normal page-level CSS.
  cssInjectionMode: 'ui',

  async main(ctx) {
    console.log('LLM Chat Navigator content script loaded.');

    const ui = await createShadowRootUi(ctx, {
      name: 'llm-chat-navigator',
      position: 'inline',
      anchor: 'body',

      // Prevent some events from leaking from the Shadow DOM into ChatGPT.
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
