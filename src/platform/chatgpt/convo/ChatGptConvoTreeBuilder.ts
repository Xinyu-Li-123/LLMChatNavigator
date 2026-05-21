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

export function buildChatGptConversationTree(raw: ChatGptConversationResponse): ConvoTree {
  const mapping = raw.mapping ?? {};
  const currentPath = getPathToRoot(raw.current_node ?? null, mapping);
  const currentPathSet = new Set(currentPath);
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
      isCurrentPath: currentPathSet.has(id),
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
    currentNodeId: raw.current_node ?? null,
    rootIds,
    nodes,
  };
}

export function buildConvoSnapshotFromChatGptResponse(
  response: ChatGptConversationResponse,
  convoUrl = location.href,
): ConvoSnapshot {
  const tree = buildChatGptConversationTree(response);

  return {
    convoMetadata: {
      convoId: tree.conversationId,
      convoTitle: tree.title,
      convoUrl,
    },
    curNodeId: tree.currentNodeId,
    tree,
  };
}
