import { buildConversationTree, computeBranchSteps, getConversationIdFromUrl } from '@/src/shared/chatgptTree';
import type { ApiResult, ChatGptBackgroundRequest, ChatGptConversationResponse, NavigatorSnapshot } from '@/src/shared/types';
import {
  checkMissingNodes,
  editChatGptMessage,
  executeChatGptBranchSteps,
  getVisibleChatGptMessageIds,
  scrollToChatGptNode,
  submitReplyByEditingVisibleChild,
} from './chatgptDom';

type SnapshotOptions = {
  force?: boolean;
};

let cachedSnapshot: NavigatorSnapshot | null = null;
let cachedConversationId: string | null = null;
let pendingSnapshot: Promise<NavigatorSnapshot> | null = null;
let pendingConversationId: string | null = null;

async function fetchRawConversation(): Promise<ChatGptConversationResponse> {
  const conversationId = getConversationIdFromUrl();
  if (!conversationId) throw new Error('Could not detect a ChatGPT conversation ID from this tab URL.');

  const response = (await browser.runtime.sendMessage({
    type: 'LLM_NAV_FETCH_CHATGPT_CONVERSATION',
    conversationId,
  } satisfies ChatGptBackgroundRequest)) as ApiResult<ChatGptConversationResponse>;

  if (!response?.ok) throw new Error(response?.error ?? 'Failed to fetch ChatGPT conversation.');
  return response.data;
}

export async function fetchNavigatorSnapshot(options: SnapshotOptions = {}): Promise<NavigatorSnapshot> {
  const conversationId = getConversationIdFromUrl();
  if (!conversationId) throw new Error('Could not detect a ChatGPT conversation ID from this tab URL.');
  if (!options.force && cachedSnapshot && cachedConversationId === conversationId) return cachedSnapshot;
  if (!options.force && pendingSnapshot && pendingConversationId === conversationId) return pendingSnapshot;

  pendingConversationId = conversationId;
  const snapshotPromise = (async () => {
    const raw = await fetchRawConversation();
    const visibleIds = getVisibleChatGptMessageIds();
    const tree = buildConversationTree(raw, visibleIds);
    const nodeIds = Object.keys(tree.nodes);
    cachedConversationId = conversationId;
    cachedSnapshot = {
      tree,
      visibleMissingNodeIds: checkMissingNodes(nodeIds),
    };
    return cachedSnapshot;
  })();
  pendingSnapshot = snapshotPromise;

  try {
    return await snapshotPromise;
  } finally {
    if (pendingSnapshot === snapshotPromise) {
      pendingSnapshot = null;
      pendingConversationId = null;
    }
  }
}

export async function navigateToNode(nodeId: string): Promise<void> {
  const snapshot = await fetchNavigatorSnapshot();
  const steps = computeBranchSteps(snapshot.tree, nodeId);
  if (steps.length > 0) await executeChatGptBranchSteps(steps);
  const ok = await scrollToChatGptNode(nodeId);
  if (!ok && steps.length === 0) throw new Error(`Could not find visible message node ${nodeId}.`);
}

export async function editMessage(nodeId: string, text: string): Promise<void> {
  await navigateToNode(nodeId);
  await editChatGptMessage(nodeId, text);
  cachedSnapshot = null;
  pendingSnapshot = null;
  pendingConversationId = null;
}

export async function submitReply(parentNodeId: string, text: string): Promise<void> {
  const snapshot = await fetchNavigatorSnapshot();
  const parent = snapshot.tree.nodes[parentNodeId];
  if (!parent) throw new Error(`Unknown parent node ${parentNodeId}.`);
  if (parent.childIds.length === 0) {
    throw new Error('This MVP creates a branch by editing an existing visible child. Select a node that already has a child response.');
  }

  await navigateToNode(parent.childIds[0]);
  await submitReplyByEditingVisibleChild(parent.childIds, text);
  cachedSnapshot = null;
  pendingSnapshot = null;
  pendingConversationId = null;
}
