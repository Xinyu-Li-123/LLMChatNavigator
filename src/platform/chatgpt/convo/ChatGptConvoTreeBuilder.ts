import type { ConvoSnapshot } from '@/src/convo/types';
import type {
  ChatGptConversationResponse,
  ChatGptRawMessage,
  ConvoNode,
  ConvoTree,
  MessageRole,
} from '@/src/shared/types';

export function getChatGptConversationIdFromUrl(urlText = location.href): string | null {
  const url = new URL(urlText);
  if (url.origin !== 'https://chatgpt.com' && url.origin !== 'https://chat.openai.com') {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const conversationIndex = parts.indexOf('c');
  if (conversationIndex >= 0 && parts[conversationIndex + 1]) {
    return parts[conversationIndex + 1];
  }

  const last = parts.at(-1);
  return last && /^[a-zA-Z0-9_-]{8,}$/.test(last) ? last : null;
}

function messageText(message?: ChatGptRawMessage | null): string {
  if (!message?.content) return '';

  const { content } = message;
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const candidate = part as Record<string, unknown>;
          if (typeof candidate.text === 'string') return candidate.text;
          if (typeof candidate.content === 'string') return candidate.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (typeof content.text === 'string') return content.text.trim();
  return '';
}

function messageRole(message?: ChatGptRawMessage | null): MessageRole {
  const role = message?.author?.role;
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return 'unknown';
}

function getPathToRoot(
  nodeId: string | null,
  mapping: NonNullable<ChatGptConversationResponse['mapping']>,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = nodeId;

  while (current && mapping[current] && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    current = mapping[current].parent ?? null;
  }

  return path.reverse();
}

function getPathToTreeRoot(
  nodeId: string | null,
  tree: Pick<ConvoTree, 'nodes'>,
): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = nodeId;

  while (current && tree.nodes[current] && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    current = tree.nodes[current].parentId;
  }

  return path.reverse();
}

function getLastChildId(node: Pick<ConvoNode, 'childIds'>): string | null {
  return node.childIds.at(-1) ?? null;
}

export function buildDefaultSelectedChildIdByParentId(
  tree: Pick<ConvoTree, 'nodes' | 'rootIds'>,
  leafNodeId: string | null,
): Record<string, string> {
  const selectedChildIdByParentId: Record<string, string> = {};

  for (const node of Object.values(tree.nodes)) {
    if (node.childIds.length > 1) {
      const lastChildId = getLastChildId(node);
      if (lastChildId) selectedChildIdByParentId[node.id] = lastChildId;
    }
  }

  const path = getPathToTreeRoot(leafNodeId, tree);
  for (let index = 0; index < path.length - 1; index++) {
    const parentId = path[index];
    const childId = path[index + 1];
    const parent = tree.nodes[parentId];
    if (parent && parent.childIds.length > 1) {
      selectedChildIdByParentId[parentId] = childId;
    }
  }

  return selectedChildIdByParentId;
}

export function normalizeSelectedChildIdByParentId(
  tree: Pick<ConvoTree, 'nodes' | 'rootIds'>,
  selectedChildIdByParentId: Record<string, string>,
): Record<string, string> {
  const normalized = buildDefaultSelectedChildIdByParentId(tree, null);

  for (const [parentId, childId] of Object.entries(selectedChildIdByParentId)) {
    const parent = tree.nodes[parentId];
    if (!parent || parent.childIds.length <= 1) continue;
    if (!parent.childIds.includes(childId)) continue;
    normalized[parentId] = childId;
  }

  return normalized;
}

function buildActivePathNodeIds(
  tree: Pick<ConvoTree, 'nodes' | 'rootIds'>,
  uiCurNodeId: string | null,
  selectedChildIdByParentId: Record<string, string>,
): string[] {
  const path = getPathToTreeRoot(uiCurNodeId, tree);
  const seen = new Set(path);
  let currentId = path.at(-1) ?? null;

  while (currentId) {
    const node = tree.nodes[currentId];
    if (!node) break;

    let nextChildId: string | null = null;
    if (node.childIds.length === 1) {
      nextChildId = node.childIds[0] ?? null;
    } else if (node.childIds.length > 1) {
      nextChildId = selectedChildIdByParentId[node.id] ?? getLastChildId(node);
    }

    if (!nextChildId || seen.has(nextChildId)) break;
    path.push(nextChildId);
    seen.add(nextChildId);
    currentId = nextChildId;
  }

  return path;
}

export function applyCurrentPathState(
  tree: ConvoTree,
  uiCurNodeId: string | null,
  selectedChildIdByParentId: Record<string, string>,
): ConvoTree {
  const normalizedSelectedChildIdByParentId = normalizeSelectedChildIdByParentId(
    tree,
    selectedChildIdByParentId,
  );
  const currentPathSet = new Set(
    buildActivePathNodeIds(tree, uiCurNodeId, normalizedSelectedChildIdByParentId),
  );

  for (const node of Object.values(tree.nodes)) {
    node.isCurrentPath = currentPathSet.has(node.id);
  }

  tree.uiCurNodeId = uiCurNodeId;
  tree.selectedChildIdByParentId = normalizedSelectedChildIdByParentId;
  return tree;
}

export function buildChatGptConversationTree(raw: ChatGptConversationResponse): ConvoTree {
  const mapping = raw.mapping ?? {};
  const backendCurNodeId = raw.current_node ?? null;
  const nodes: Record<string, ConvoNode> = {};

  for (const [id, rawNode] of Object.entries(mapping)) {
    const parentId = rawNode.parent ?? null;
    const siblings = parentId ? mapping[parentId]?.children ?? [] : [];
    const text = messageText(rawNode.message);
    const role = messageRole(rawNode.message);

    nodes[id] = {
      id,
      role,
      text,
      parentId,
      childIds: rawNode.children ?? [],
      siblingIndex: siblings.indexOf(id),
      isCurrentPath: false,
      isVisible: true,
      createTime: rawNode.message?.create_time ?? null,
    };
  }

  const rootIds = Object.values(nodes)
    .filter((node) => !node.parentId)
    .map((node) => node.id);

  return {
    provider: 'chatgpt',
    conversationId: raw.id ?? '',
    title: raw.title ?? 'ChatGpt conversation',
    backendCurNodeId,
    uiCurNodeId: backendCurNodeId,
    selectedChildIdByParentId: {},
    rootIds,
    nodes,
  };
}

export function buildConvoSnapshotFromChatGptResponse(
  response: ChatGptConversationResponse,
  convoUrl = location.href,
): ConvoSnapshot {
  const tree = buildChatGptConversationTree(response);
  const selectedChildIdByParentId = buildDefaultSelectedChildIdByParentId(
    tree,
    response.current_node ?? null,
  );
  applyCurrentPathState(tree, response.current_node ?? null, selectedChildIdByParentId);

  return {
    convoMetadata: {
      convoId: tree.conversationId,
      convoTitle: tree.title,
      convoUrl,
    },
    tree,
  };
}
