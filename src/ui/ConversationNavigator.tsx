import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { Bug, Check, ChevronLeft, ChevronRight, Edit3, Loader2, LocateFixed, Moon, RefreshCw, Search, Sun, SunMoon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { ConvoController } from '@/src/convo/ConvoController';
import type { ConvoSnapshot } from '@/src/convo/types';
import type { NavigatorTheme } from '@/src/shared/navigatorUiConfig';
import type { ConvoNode } from '@/src/shared/types';

type ConversationNavigatorProps = {
  controller: ConvoController;
  compact?: boolean;
  theme?: NavigatorTheme;
  onThemeChange?: (theme: NavigatorTheme) => void;
  isDebug?: boolean;
  onDebugChange?: (isDebug: boolean) => void;
  utilityRowCollapsed?: boolean;
  onUtilityRowCollapsedChange?: (collapsed: boolean) => void;
  onTitleChange?: (title: string) => void;
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
  node: ConvoNode;
  childIds: string[];
};

type DisplayTree = {
  roots: string[];
  items: Map<string, DisplayItem>;
  conversationNodeCount: number;
};

type MessageNodeData = {
  node: ConvoNode;
  displayedChildCount: number;
  selected: boolean;
  compact: boolean;
  isDebug: boolean;
} & Record<string, unknown>;

type MessageFlowNode = Node<MessageNodeData, 'message'>;

const NODE_WIDTH = 260;
const NODE_HEIGHT = 124;
const X_GAP = 44;
const Y_GAP = 96;

function roleLabel(role: ConvoNode['role']) {
  if (role === 'user') return 'You';
  if (role === 'assistant') return 'Assistant';
  return role;
}

function roleClass(role: ConvoNode['role']) {
  if (role === 'user') return 'bg-blue-500/10 text-blue-700 dark:text-blue-300';
  if (role === 'assistant') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return 'bg-muted text-muted-foreground';
}

function isConversationNode(node: ConvoNode): boolean {
  return (node.role === 'user' || node.role === 'assistant') && Boolean(node.text.trim());
}

function matchesQuery(node: ConvoNode, query: string): boolean {
  if (!query) return true;
  return `${node.role} ${node.text}`.toLowerCase().includes(query);
}

function visibleText(text: string, limit = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty message)';
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function buildDisplayTree(snapshot: ConvoSnapshot | null, query: string): DisplayTree {
  const items = new Map<string, DisplayItem>();
  const roots: string[] = [];
  let conversationNodeCount = 0;
  if (!snapshot) return { roots, items, conversationNodeCount };

  const normalizedQuery = query.trim().toLowerCase();
  const { tree } = snapshot;

  function addDisplayedNode(node: ConvoNode, parentId: string | null) {
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

function selectedConversationNodeId(snapshot: ConvoSnapshot): string | null {
  let current = snapshot.tree.uiCurNodeId;
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
  isDebug: boolean,
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
        isDebug,
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
        style: { stroke: 'var(--border)', strokeWidth: 1.5 },
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
  const messageTextClassName = data.isDebug ? 'line-clamp-4' : 'line-clamp-5';

  return (
    <div
      className={cn(
        'flex h-[124px] w-[260px] flex-col rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-shadow',
        data.selected && 'border-primary shadow-md ring-2 ring-primary/20',
        data.node.isCurrentPath && !data.selected && 'border-primary/40',
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
      <div className={cn('flex-1 overflow-hidden text-xs leading-snug', messageTextClassName)}>
        {visibleText(data.node.text, data.compact ? 180 : 220)}
      </div>
      {data.isDebug ? (
        <div className="mt-2 truncate text-[10px] text-muted-foreground">
          {data.node.id}
        </div>
      ) : null}
      <Handle type="source" position={FlowPosition.Bottom} className="opacity-0" />
    </div>
  );
}

const nodeTypes = {
  message: MessageNode,
} satisfies NodeTypes;

type ReactFlowCssProperties = CSSProperties & Record<`--${string}`, string>;

const flowStyle: ReactFlowCssProperties = {
  backgroundColor: 'var(--background)',
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-background-color-hover': 'var(--accent)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-controls-button-color-hover': 'var(--foreground)',
};

/**
 * A div that contains a ReactFlow graph, and a floating, collapsable toolbar of buttons 
 * that can operate on the graph (e.g. switch to dark mode). 
 * This component is reuseable in both ChatNavFloatingUi and ChatNavPopupWindowUi.
 */
export default function ConversationNavigator({
  controller,
  compact = false,
  theme = 'auto',
  onThemeChange,
  isDebug = true,
  onDebugChange,
  utilityRowCollapsed = false,
  onUtilityRowCollapsedChange,
  onTitleChange,
}: ConversationNavigatorProps) {
  const [snapshot, setSnapshot] = useState<ConvoSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const query = '';
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<MessageFlowNode, Edge> | null>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const savedViewportRef = useRef<Viewport | null>(null);
  const fitInitialViewRef = useRef(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      await controller.syncConvo();
      const next = controller.getSnapshot();
      if (!next) throw new Error('No conversation snapshot is available after refresh.');
      setSnapshot(next);
      setSelectedNodeId(selectedConversationNodeId(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const handleFlowInit = useCallback((instance: ReactFlowInstance<MessageFlowNode, Edge>) => {
    flowInstanceRef.current = instance;
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
  }, [controller]);

  useEffect(() => {
    onTitleChange?.(snapshot?.convoMetadata.convoTitle ?? 'Current conversation');
  }, [onTitleChange, snapshot]);

  useEffect(() => {
    if (!themeMenuOpen) return;

    function handleDocumentClick(event: MouseEvent) {
      if (themeMenuRef.current?.contains(event.target as globalThis.Node)) return;
      setThemeMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setThemeMenuOpen(false);
    }

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [themeMenuOpen]);

  const displayTree = useMemo(() => buildDisplayTree(snapshot, query), [query, snapshot]);

  const flowElements = useMemo(
    () => layoutDisplayTree(displayTree, selectedNodeId, compact, isDebug),
    [compact, displayTree, isDebug, selectedNodeId],
  );

  const selectedNode = selectedNodeId && snapshot ? snapshot.tree.nodes[selectedNodeId] : null;
  const menuNode = contextMenu && snapshot ? snapshot.tree.nodes[contextMenu.nodeId] : null;
  const editNode = editDialog && snapshot ? snapshot.tree.nodes[editDialog.nodeId] : null;

  const themeOptionMeta: Record<NavigatorTheme, { label: string; title: string; icon: typeof Sun }> = {
    auto: { label: 'Auto', title: 'Use system theme', icon: SunMoon },
    light: { label: 'Light', title: 'Use light theme', icon: Sun },
    dark: { label: 'Dark', title: 'Use dark theme', icon: Moon },
  };
  const ThemeIcon = themeOptionMeta[theme].icon;

  async function runAction(label: string, action: () => Promise<void>, refreshAfter = true): Promise<boolean> {
    setBusyAction(label);
    setError(null);
    try {
      await action();
      if (refreshAfter) await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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
    void runAction('navigate', () => controller.navigateToNode(nodeId), false);
  }, [controller, contextMenu]);

  const handleOpenEdit = useCallback(() => {
    if (!menuNode) return;
    setEditDialog({ nodeId: menuNode.id, text: menuNode.text });
    setContextMenu(null);
  }, [menuNode]);

  const handleSubmitEdit = useCallback(() => {
    if (!editDialog || !snapshot) return;
    const { nodeId, text } = editDialog;
    const node = snapshot.tree.nodes[nodeId];
    void runAction('edit', async () => {
      if (!node?.parentId) throw new Error('Cannot resend a root message.');
      await controller.submitReply(node.parentId, text);
    }).then((success) => {
      if (success) setEditDialog(null);
    });
  }, [controller, editDialog, snapshot]);

  const handleGoToSelected = useCallback(() => {
    if (!selectedNodeId) return;

    const selectedFlowNode = flowElements.nodes.find((node) => node.id === selectedNodeId);
    void runAction('navigate', async () => {
      const instance = flowInstanceRef.current;
      if (instance && selectedFlowNode) {
        const viewport = instance.getViewport();
        await instance.setCenter(
          selectedFlowNode.position.x + NODE_WIDTH / 2,
          selectedFlowNode.position.y + NODE_HEIGHT / 2,
          { zoom: viewport.zoom, duration: 250 },
        );
      }

      await controller.navigateToNode(selectedNodeId);
    }, false);
  }, [controller, flowElements.nodes, selectedNodeId]);

  const body = (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      {error ? (
        <div className="mx-3 mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div
        ref={flowWrapperRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden bg-background',
          '[&_.react-flow__controls]:overflow-hidden [&_.react-flow__controls]:rounded-xl [&_.react-flow__controls]:border [&_.react-flow__controls]:border-border [&_.react-flow__controls]:bg-card/95 [&_.react-flow__controls]:shadow-lg [&_.react-flow__controls-button]:h-11 [&_.react-flow__controls-button]:w-11 [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-transparent [&_.react-flow__controls-button>svg]:h-5 [&_.react-flow__controls-button>svg]:w-5',
        )}
      >
        {utilityRowCollapsed ? (
          <div className="absolute right-0 top-3 z-20">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-6 rounded-r-none rounded-l-md border-r-0 bg-card/95 p-0 shadow-lg backdrop-blur"
              title="Expand toolbar"
              aria-label="Expand toolbar"
              onClick={() => onUtilityRowCollapsedChange?.(false)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <div className="absolute right-3 top-3 z-20 flex items-center rounded-md border bg-card/95 shadow-lg backdrop-blur">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              title="Search conversations"
              aria-label="Search conversations"
              disabled
              onClick={() => { }}
            >
              <Search className="h-4 w-4" />
            </Button>
            {onThemeChange ? (
              <div ref={themeMenuRef} className="relative">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  onClick={(event) => {
                    event.stopPropagation();
                    setThemeMenuOpen((current) => !current);
                  }}
                  title={themeOptionMeta[theme].title}
                  aria-label={themeOptionMeta[theme].title}
                  aria-haspopup="menu"
                  aria-expanded={themeMenuOpen}
                >
                  <ThemeIcon className="h-5 w-5" />
                </Button>
                {themeMenuOpen ? (
                  <div
                    className="absolute right-0 top-full mt-2 min-w-36 overflow-hidden rounded-md border bg-popover text-sm text-popover-foreground shadow-lg"
                    role="menu"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {(Object.entries(themeOptionMeta) as [NavigatorTheme, typeof themeOptionMeta[NavigatorTheme]][]).map(([value, option]) => {
                      const OptionIcon = option.icon;
                      return (
                        <button
                          key={value}
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent',
                            theme === value && 'bg-accent/60',
                          )}
                          role="menuitemradio"
                          aria-checked={theme === value}
                          onClick={(event) => {
                            event.stopPropagation();
                            onThemeChange(value);
                            setThemeMenuOpen(false);
                          }}
                        >
                          <OptionIcon className="h-4 w-4" />
                          <span className="flex-1">{option.label}</span>
                          {theme === value ? <Check className="h-4 w-4" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {onDebugChange ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn('h-9 w-9', isDebug && 'bg-accent/60')}
                onClick={() => onDebugChange(!isDebug)}
                title={isDebug ? 'Hide debug details' : 'Show debug details'}
                aria-label={isDebug ? 'Hide debug details' : 'Show debug details'}
                aria-pressed={isDebug}
              >
                <Bug className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => void refresh()}
              disabled={loading}
              title="Refresh tree"
              aria-label="Refresh tree"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={handleGoToSelected}
              disabled={!selectedNodeId || busyAction === 'navigate'}
              title="Select and scroll to selected message"
              aria-label="Select and scroll to selected message"
            >
              <LocateFixed className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-6"
              title="Collapse toolbar"
              aria-label="Collapse toolbar"
              onClick={() => onUtilityRowCollapsedChange?.(true)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        )}

        {flowElements.nodes.length > 0 ? (
          <ReactFlow
            className="bg-background"
            nodes={flowElements.nodes}
            edges={flowElements.edges}
            nodeTypes={nodeTypes}
            style={flowStyle}
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
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="var(--border)" />
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
              disabled={Boolean(busyAction) || !menuNode.parentId}
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
              <Button type="button" onClick={handleSubmitEdit} disabled={!editDialog.text.trim() || Boolean(busyAction) || !editNode.parentId}>
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
        <CardTitle>ChatGpt Tree Navigator</CardTitle>
      </CardHeader>
      <CardContent className="h-full p-0">{body}</CardContent>
    </Card>
  );
}
