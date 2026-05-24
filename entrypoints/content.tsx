import '@/assets/tailwind.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';

import ChatNavFloatingUi from '@/src/ui/ChatNavFloatingUi';
import ChatGptConvoController from '@/src/platform/chatgpt/convo/ChatGptConvoController';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const convoController = new ChatGptConvoController();

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
        // TODO: Here, we should instantiate a platform-agnostic <LLMChatNavigatorUI />, 
        // and pass in our platform-specific adaptor as a prop value of type ConvoAdaptor (platform-agnostic)
        // TODO: This also means we can use a dummy adaptor impl for testing
        root.render(
          <React.StrictMode>
            <ChatNavFloatingUi controller={convoController} />
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
