import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position as FlowPosition,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { Edit3, Loader2, LocateFixed, RefreshCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { visibleText } from '@/src/shared/chatgptTree';
import type { ConversationNode, NavigatorSnapshot } from '@/src/shared/types';

export type NavigatorApi = {
  fetchSnapshot(options?: { force?: boolean }): Promise<NavigatorSnapshot>;
  navigateToNode(nodeId: string): Promise<void>;
  editMessage(nodeId: string, text: string): Promise<void>;
  submitReply(parentNodeId: string, text: string): Promise<void>;
};

type ConversationNavigatorProps = {
  api: NavigatorApi;
  compact?: boolean;
};

type ContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

type EditDialogState = {
  nodeId: string;
  text: string;
};

type DisplayItem = {
  node: ConversationNode;
  childIds: string[];
};

type DisplayTree = {
  roots: string[];
  items: Map<string, DisplayItem>;
  conversationNodeCount: number;
};

type MessageNodeData = {
  node: ConversationNode;
  displayedChildCount: number;
  selected: boolean;
  compact: boolean;
} & Record<string, unknown>;

type MessageFlowNode = Node<MessageNodeData, 'message'>;

const NODE_WIDTH = 260;
const NODE_HEIGHT = 124;
const X_GAP = 44;
const Y_GAP = 96;

function roleLabel(role: ConversationNode['role']) {
  if (role === 'user') return 'You';
  if (role === 'assistant') return 'Assistant';
  return role;
}

function roleClass(role: ConversationNode['role']) {
  if (role === 'user') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
  if (role === 'assistant') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return 'bg-muted text-muted-foreground';
}

function isConversationNode(node: ConversationNode): boolean {
  return (node.role === 'user' || node.role === 'assistant') && Boolean(node.text.trim());
}

function matchesQuery(node: ConversationNode, query: string): boolean {
  if (!query) return true;
  return `${node.role} ${node.text}`.toLowerCase().includes(query);
}

function buildDisplayTree(snapshot: NavigatorSnapshot | null, query: string): DisplayTree {
  const items = new Map<string, DisplayItem>();
  const roots: string[] = [];
  let conversationNodeCount = 0;
  if (!snapshot) return { roots, items, conversationNodeCount };

  const normalizedQuery = query.trim().toLowerCase();
  const { tree } = snapshot;

  function addDisplayedNode(node: ConversationNode, parentId: string | null) {
    if (!items.has(node.id)) {
      items.set(node.id, { node, childIds: [] });
    }

    if (parentId) {
      const parent = items.get(parentId);
      if (parent && !parent.childIds.includes(node.id)) parent.childIds.push(node.id);
    } else if (!roots.includes(node.id)) {
      roots.push(node.id);
    }
  }

  function visit(nodeId: string, nearestDisplayedAncestorId: string | null) {
    const node = tree.nodes[nodeId];
    if (!node) return;

    const isConversation = isConversationNode(node);
    if (isConversation) conversationNodeCount += 1;

    let nextAncestorId = nearestDisplayedAncestorId;
    if (isConversation && matchesQuery(node, normalizedQuery)) {
      addDisplayedNode(node, nearestDisplayedAncestorId);
      nextAncestorId = node.id;
    }

    for (const childId of node.childIds) visit(childId, nextAncestorId);
  }

  for (const rootId of tree.rootIds) visit(rootId, null);
  return { roots, items, conversationNodeCount };
}

function selectedConversationNodeId(snapshot: NavigatorSnapshot): string | null {
  let current = snapshot.tree.currentNodeId;
  const seen = new Set<string>();

  while (current && snapshot.tree.nodes[current] && !seen.has(current)) {
    seen.add(current);
    const node = snapshot.tree.nodes[current];
    if (isConversationNode(node)) return node.id;
    current = node.parentId;
  }

  return null;
}

function layoutDisplayTree(
  displayTree: DisplayTree,
  selectedNodeId: string | null,
  compact: boolean,
): { nodes: MessageFlowNode[]; edges: Edge[] } {
  const subtreeWidths = new Map<string, number>();
  const nodes: MessageFlowNode[] = [];
  const edges: Edge[] = [];

  function measure(nodeId: string): number {
    const item = displayTree.items.get(nodeId);
    if (!item || item.childIds.length === 0) {
      subtreeWidths.set(nodeId, NODE_WIDTH);
      return NODE_WIDTH;
    }

    const childrenWidth = item.childIds.reduce((total, childId, index) => {
      return total + measure(childId) + (index === 0 ? 0 : X_GAP);
    }, 0);
    const width = Math.max(NODE_WIDTH, childrenWidth);
    subtreeWidths.set(nodeId, width);
    return width;
  }

  function place(nodeId: string, left: number, depth: number) {
    const item = displayTree.items.get(nodeId);
    if (!item) return;

    const width = subtreeWidths.get(nodeId) ?? NODE_WIDTH;
    nodes.push({
      id: nodeId,
      type: 'message',
      position: {
        x: left + width / 2 - NODE_WIDTH / 2,
        y: depth * (NODE_HEIGHT + Y_GAP),
      },
      data: {
        node: item.node,
        displayedChildCount: item.childIds.length,
        selected: item.node.id === selectedNodeId,
        compact,
      },
      draggable: false,
      selectable: true,
    });

    let childLeft = left + Math.max(0, width - childRowWidth(item.childIds)) / 2;
    for (const childId of item.childIds) {
      edges.push({
        id: `${nodeId}->${childId}`,
        source: nodeId,
        target: childId,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { strokeWidth: 1.5 },
      });

      place(childId, childLeft, depth + 1);
      childLeft += (subtreeWidths.get(childId) ?? NODE_WIDTH) + X_GAP;
    }
  }

  function childRowWidth(childIds: string[]): number {
    return childIds.reduce((total, childId, index) => {
      return total + (subtreeWidths.get(childId) ?? NODE_WIDTH) + (index === 0 ? 0 : X_GAP);
    }, 0);
  }

  let left = 0;
  for (const rootId of displayTree.roots) {
    const width = measure(rootId);
    place(rootId, left, 0);
    left += width + X_GAP * 2;
  }

  return { nodes, edges };
}

function MessageNode({ data }: NodeProps<MessageFlowNode>) {
  const childCount = data.displayedChildCount;

  return (
    <div
      className={cn(
        'w-[260px] rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-shadow',
        data.selected && 'border-primary shadow-md ring-2 ring-primary/20',
        data.node.isCurrentPath && !data.selected && 'border-primary/40',
        !data.node.isVisible && 'opacity-70',
      )}
    >
      <Handle type="target" position={FlowPosition.Top} className="opacity-0" />
      <div className="mb-2 flex min-w-0 items-center gap-1">
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', roleClass(data.node.role))}>
          {roleLabel(data.node.role)}
        </span>
        {childCount > 1 ? (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
            {childCount} branches
          </span>
        ) : null}
      </div>
      <div className="line-clamp-5 text-xs leading-snug">{visibleText(data.node.text, data.compact ? 180 : 220)}</div>
      <Handle type="source" position={FlowPosition.Bottom} className="opacity-0" />
    </div>
  );
}

const nodeTypes = {
  message: MessageNode,
} satisfies NodeTypes;

export default function ConversationNavigator({ api, compact = false }: ConversationNavigatorProps) {
  const [snapshot, setSnapshot] = useState<NavigatorSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const savedViewportRef = useRef<Viewport | null>(null);
  const fitInitialViewRef = useRef(false);

  async function refresh(options: { force?: boolean } = {}) {
    setLoading(true);
    setError(null);
    try {
      const next = await api.fetchSnapshot(options);
      setSnapshot(next);
      setSelectedNodeId(selectedConversationNodeId(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const handleFlowInit = useCallback((instance: ReactFlowInstance<MessageFlowNode, Edge>) => {
    if (savedViewportRef.current) {
      void instance.setViewport(savedViewportRef.current);
      return;
    }

    if (!fitInitialViewRef.current) {
      fitInitialViewRef.current = true;
      window.setTimeout(() => {
        void instance.fitView({ padding: 0.2, minZoom: 0.35, maxZoom: 1.1 });
      }, 0);
    }
  }, []);

  const handleViewportChange = useCallback((viewport: Viewport) => {
    savedViewportRef.current = viewport;
  }, []);

  useEffect(() => {
    void refresh();
  }, []);

  const displayTree = useMemo(() => buildDisplayTree(snapshot, query), [query, snapshot]);

  const flowElements = useMemo(
    () => layoutDisplayTree(displayTree, selectedNodeId, compact),
    [compact, displayTree, selectedNodeId],
  );

  const selectedNode = selectedNodeId && snapshot ? snapshot.tree.nodes[selectedNodeId] : null;
  const menuNode = contextMenu && snapshot ? snapshot.tree.nodes[contextMenu.nodeId] : null;
  const editNode = editDialog && snapshot ? snapshot.tree.nodes[editDialog.nodeId] : null;

  async function runAction(label: string, action: () => Promise<void>, refreshAfter = true) {
    setBusyAction(label);
    setError(null);
    try {
      await action();
      if (refreshAfter) await refresh({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  const handleNodeContextMenu = useCallback<NodeMouseHandler<MessageFlowNode>>((event, node) => {
    event.preventDefault();
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    setSelectedNodeId(node.id);
    setContextMenu({
      nodeId: node.id,
      x: bounds ? event.clientX - bounds.left : event.clientX,
      y: bounds ? event.clientY - bounds.top : event.clientY,
    });
  }, []);

  const handleSelectAndScroll = useCallback(() => {
    if (!contextMenu) return;
    const nodeId = contextMenu.nodeId;
    setContextMenu(null);
    setSelectedNodeId(nodeId);
    void runAction('navigate', () => api.navigateToNode(nodeId), false);
  }, [api, contextMenu]);

  const handleOpenEdit = useCallback(() => {
    if (!menuNode) return;
    setEditDialog({ nodeId: menuNode.id, text: menuNode.text });
    setContextMenu(null);
  }, [menuNode]);

  const handleSubmitEdit = useCallback(() => {
    if (!editDialog) return;
    const { nodeId, text } = editDialog;
    void runAction('edit', () => api.editMessage(nodeId, text)).then(() => {
      setEditDialog(null);
    });
  }, [api, editDialog]);

  const body = (
    <div className="relative flex h-full min-h-0 flex-col bg-white text-foreground" style={{ backgroundColor: '#fff' }}>
      <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {snapshot?.tree.title ?? 'Current conversation'}
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void refresh({ force: true })}
          disabled={loading}
          title="Refresh tree"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <Separator />

      <div className="space-y-2 p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search messages..."
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        {snapshot ? (
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{displayTree.conversationNodeCount} conversation messages</span>
            <span>|</span>
            <span>{flowElements.nodes.length} shown</span>
            <span>|</span>
            <span>{snapshot.visibleMissingNodeIds.length} hidden/not rendered</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div ref={flowWrapperRef} className="relative min-h-0 flex-1 overflow-hidden bg-white" style={{ backgroundColor: '#fff' }}>
        {flowElements.nodes.length > 0 ? (
          <ReactFlow
            className="bg-white"
            nodes={flowElements.nodes}
            edges={flowElements.edges}
            nodeTypes={nodeTypes}
            style={{ backgroundColor: '#fff' }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.2}
            maxZoom={1.8}
            onInit={handleFlowInit}
            onViewportChange={handleViewportChange}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setContextMenu(null);
            }}
            onNodeContextMenu={handleNodeContextMenu}
            onPaneClick={() => setContextMenu(null)}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {loading ? 'Loading conversation tree...' : 'No conversation messages found.'}
          </div>
        )}

        {contextMenu && menuNode ? (
          <div
            className="absolute z-20 w-52 overflow-hidden rounded-md border bg-popover text-sm text-popover-foreground shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={handleSelectAndScroll}
              disabled={Boolean(busyAction)}
            >
              <LocateFixed className="h-4 w-4" />
              Select and scroll
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
              onClick={handleOpenEdit}
              disabled={Boolean(busyAction)}
            >
              <Edit3 className="h-4 w-4" />
              Edit and resend
            </button>
          </div>
        ) : null}
      </div>

      <Separator />

      <div className="flex min-h-10 items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        {selectedNode ? (
          <>
            <span>Selected:</span>
            <span className="font-medium text-foreground">{roleLabel(selectedNode.role)}</span>
            <span className="truncate">{visibleText(selectedNode.text, compact ? 70 : 110)}</span>
          </>
        ) : (
          'Right-click a message for actions.'
        )}
      </div>

      {editDialog && editNode ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border bg-card p-4 text-card-foreground shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Edit and resend</div>
                <div className="truncate text-xs text-muted-foreground">{roleLabel(editNode.role)} message</div>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setEditDialog(null)}
                disabled={Boolean(busyAction)}
                title="Close editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <textarea
              value={editDialog.text}
              onChange={(event) => setEditDialog((current) => current ? { ...current, text: event.target.value } : current)}
              className="h-36 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditDialog(null)} disabled={Boolean(busyAction)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmitEdit} disabled={!editDialog.text.trim() || Boolean(busyAction)}>
                {busyAction === 'edit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
                Resend
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (compact) return body;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="sr-only">
        <CardTitle>ChatGPT Tree Navigator</CardTitle>
      </CardHeader>
      <CardContent className="h-full p-0">{body}</CardContent>
    </Card>
  );
}
