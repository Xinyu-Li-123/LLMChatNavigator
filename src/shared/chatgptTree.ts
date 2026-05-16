import type {
  BranchStep,
  ChatGptConversationResponse,
  ChatGptRawMessage,
  ConversationNode,
  ConversationTree,
  MessageRole,
} from './types';

export function getConversationIdFromUrl(urlText = location.href): string | null {
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

export function messageText(message?: ChatGptRawMessage | null): string {
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

export function messageRole(message?: ChatGptRawMessage | null): MessageRole {
  const role = message?.author?.role;
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  return 'unknown';
}

export function buildConversationTree(
  raw: ChatGptConversationResponse,
  visibleNodeIds: Set<string> = new Set(),
): ConversationTree {
  const mapping = raw.mapping ?? {};
  const currentPath = getPathToRoot(raw.current_node ?? null, mapping);
  const currentPathSet = new Set(currentPath);
  const nodes: Record<string, ConversationNode> = {};

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
      isCurrentPath: currentPathSet.has(id),
      isVisible: visibleNodeIds.has(id),
      createTime: rawNode.message?.create_time ?? null,
    };
  }

  const rootIds = Object.values(nodes)
    .filter((node) => !node.parentId)
    .map((node) => node.id);

  return {
    provider: 'chatgpt',
    conversationId: raw.id ?? '',
    title: raw.title ?? 'ChatGPT conversation',
    currentNodeId: raw.current_node ?? null,
    rootIds,
    nodes,
  };
}

export function getPathToRoot(
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

export function getPathInTree(tree: ConversationTree, nodeId: string | null): string[] {
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

export function computeBranchSteps(tree: ConversationTree, targetNodeId: string): BranchStep[] {
  const currentPath = getPathInTree(tree, tree.currentNodeId);
  const targetPath = getPathInTree(tree, targetNodeId);
  const steps: BranchStep[] = [];

  const max = Math.max(currentPath.length, targetPath.length);
  for (let index = 0; index < max; index++) {
    const currentNodeId = currentPath[index];
    const targetIdAtDepth = targetPath[index];

    if (!currentNodeId || !targetIdAtDepth || currentNodeId === targetIdAtDepth) continue;

    const currentNode = tree.nodes[currentNodeId];
    const targetNode = tree.nodes[targetIdAtDepth];
    if (!currentNode || !targetNode) continue;
    if (currentNode.parentId !== targetNode.parentId) continue;

    const stepsLeft = currentNode.siblingIndex - targetNode.siblingIndex;
    if (stepsLeft !== 0) {
      steps.push({
        nodeId: currentNode.id,
        role: currentNode.role,
        stepsLeft,
      });
    }
  }

  return steps;
}

export function visibleText(text: string, limit = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty message)';
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

export function treeNodesInDisplayOrder(tree: ConversationTree): ConversationNode[] {
  const out: ConversationNode[] = [];
  const visited = new Set<string>();

  function visit(id: string, depth: number) {
    const node = tree.nodes[id];
    if (!node || visited.has(id)) return;
    visited.add(id);
    out.push({ ...node, siblingIndex: depth });
    for (const childId of node.childIds) visit(childId, depth + 1);
  }

  for (const rootId of tree.rootIds) visit(rootId, 0);
  return out;
}
