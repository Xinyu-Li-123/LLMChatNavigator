export type ChatProvider = 'chatgpt';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';

export type ChatGptRawMessage = {
  id?: string;
  author?: { role?: string };
  content?: {
    content_type?: string;
    parts?: unknown[];
    text?: string;
  };
  create_time?: number | null;
  update_time?: number | null;
  metadata?: Record<string, unknown>;
};

export type ChatGptRawNode = {
  id: string;
  message?: ChatGptRawMessage | null;
  parent?: string | null;
  children?: string[];
};

export type ChatGptConversationResponse = {
  id?: string;
  title?: string;
  current_node?: string | null;
  mapping?: Record<string, ChatGptRawNode>;
};

export type ConversationNode = {
  id: string;
  role: MessageRole;
  text: string;
  parentId: string | null;
  childIds: string[];
  siblingIndex: number;
  isCurrentPath: boolean;
  isVisible: boolean;
  createTime?: number | null;
};

export type ConversationTree = {
  provider: ChatProvider;
  conversationId: string;
  title: string;
  currentNodeId: string | null;
  rootIds: string[];
  nodes: Record<string, ConversationNode>;
};

export type BranchStep = {
  nodeId: string;
  role: MessageRole;
  stepsLeft: number;
};

export type NavigatorSnapshot = {
  tree: ConversationTree;
  visibleMissingNodeIds: string[];
};

export type ChatGptContentRequest =
  | { type: 'LLM_NAV_GET_TREE' }
  | { type: 'LLM_NAV_NAVIGATE_TO_NODE'; nodeId: string }
  | { type: 'LLM_NAV_EDIT_MESSAGE'; nodeId: string; text: string }
  | { type: 'LLM_NAV_SUBMIT_REPLY'; parentNodeId: string; text: string };

export type ChatGptBackgroundRequest =
  | { type: 'LLM_NAV_FETCH_CHATGPT_CONVERSATION'; conversationId: string }
  | { type: 'LLM_NAV_GET_CAPTURE_STATUS' };

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
