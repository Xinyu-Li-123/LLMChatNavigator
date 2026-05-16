import './App.css';

import ConversationNavigator from '@/src/ui/ConversationNavigator';
import type { NavigatorApi } from '@/src/ui/ConversationNavigator';
import type { ApiResult, ChatGptContentRequest, NavigatorSnapshot } from '@/src/shared/types';

async function getActiveChatGptTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) throw new Error('No active tab found.');

  const url = new URL(tab.url);
  if (url.origin !== 'https://chatgpt.com' && url.origin !== 'https://chat.openai.com') {
    throw new Error('Open a ChatGPT conversation tab before using this popup.');
  }

  return tab;
}

async function sendToActiveTab<T>(message: ChatGptContentRequest): Promise<T> {
  const tab = await getActiveChatGptTab();
  const response = (await browser.tabs.sendMessage(tab.id!, message)) as ApiResult<T>;
  if (!response?.ok) throw new Error(response?.error ?? 'The ChatGPT content script did not respond.');
  return response.data;
}

const popupApi: NavigatorApi = {
  fetchSnapshot: () => sendToActiveTab<NavigatorSnapshot>({ type: 'LLM_NAV_GET_TREE' }),
  navigateToNode: (nodeId) => sendToActiveTab<boolean>({ type: 'LLM_NAV_NAVIGATE_TO_NODE', nodeId }).then(() => undefined),
  editMessage: (nodeId, text) => sendToActiveTab<boolean>({ type: 'LLM_NAV_EDIT_MESSAGE', nodeId, text }).then(() => undefined),
  submitReply: (parentNodeId, text) => sendToActiveTab<boolean>({ type: 'LLM_NAV_SUBMIT_REPLY', parentNodeId, text }).then(() => undefined),
};

function App() {
  return (
    <main className="h-[640px] w-[430px] overflow-hidden bg-background text-foreground">
      <ConversationNavigator api={popupApi} />
    </main>
  );
}

export default App;
