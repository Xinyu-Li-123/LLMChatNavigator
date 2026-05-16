import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Edit3, Loader2, RefreshCw, Send, TreePine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { visibleText } from '@/src/shared/chatgptTree';
import type { ConversationNode, NavigatorSnapshot } from '@/src/shared/types';

export type NavigatorApi = {
  fetchSnapshot(): Promise<NavigatorSnapshot>;
  navigateToNode(nodeId: string): Promise<void>;
  editMessage(nodeId: string, text: string): Promise<void>;
  submitReply(parentNodeId: string, text: string): Promise<void>;
};

type ConversationNavigatorProps = {
  api: NavigatorApi;
  compact?: boolean;
};

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

function depthOf(node: ConversationNode, nodes: Record<string, ConversationNode>): number {
  let depth = 0;
  let current = node.parentId;
  const seen = new Set<string>();
  while (current && nodes[current] && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = nodes[current].parentId;
  }
  return depth;
}

function flattenTree(snapshot: NavigatorSnapshot | null): Array<{ node: ConversationNode; depth: number }> {
  if (!snapshot) return [];
  const result: Array<{ node: ConversationNode; depth: number }> = [];
  const visited = new Set<string>();
  const { tree } = snapshot;

  const visit = (nodeId: string) => {
    const node = tree.nodes[nodeId];
    if (!node || visited.has(nodeId)) return;
    visited.add(nodeId);
    if (node.text || node.role === 'user' || node.role === 'assistant') {
      result.push({ node, depth: depthOf(node, tree.nodes) });
    }
    for (const childId of node.childIds) visit(childId);
  };

  for (const rootId of tree.rootIds) visit(rootId);
  return result;
}

export default function ConversationNavigator({ api, compact = false }: ConversationNavigatorProps) {
  const [snapshot, setSnapshot] = useState<NavigatorSnapshot | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await api.fetchSnapshot();
      setSnapshot(next);
      setSelectedNodeId(next.tree.currentNodeId);
      setExpanded(new Set(Object.values(next.tree.nodes).filter((node) => node.isCurrentPath).map((node) => node.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const flatNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const all = flattenTree(snapshot);
    if (!normalizedQuery) return all;
    return all.filter(({ node }) => `${node.role} ${node.text}`.toLowerCase().includes(normalizedQuery));
  }, [query, snapshot]);

  const selectedNode = selectedNodeId && snapshot ? snapshot.tree.nodes[selectedNodeId] : null;
  const childIds = selectedNode?.childIds ?? [];
  const branchCount = childIds.length;

  async function runAction(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    setError(null);
    try {
      await action();
      if (label !== 'navigate') await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  function toggleExpanded(nodeId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const body = (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <TreePine className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">ChatGPT Treeeeee Navigator</div>
          <div className="truncate text-xs text-muted-foreground">
            {snapshot?.tree.title ?? 'Current conversation'}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => void refresh()} disabled={loading} title="Refresh tree">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <Separator />

      <div className="space-y-2 p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search messages…"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        {snapshot ? (
          <div className="flex gap-2 text-xs text-muted-foreground">
            <span>{Object.keys(snapshot.tree.nodes).length} nodes</span>
            <span>•</span>
            <span>{snapshot.visibleMissingNodeIds.length} hidden/not rendered</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="space-y-1 pb-3">
          {flatNodes.map(({ node, depth }) => {
            const hasChildren = node.childIds.length > 0;
            const selected = node.id === selectedNodeId;
            const visible = node.isVisible;

            return (
              <div key={node.id} style={{ paddingLeft: Math.min(depth, 10) * 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    void runAction('navigate', () => api.navigateToNode(node.id));
                  }}
                  className={cn(
                    'group flex w-full items-start gap-2 rounded-lg border px-2 py-2 text-left text-xs transition hover:bg-accent',
                    selected && 'border-primary bg-primary/5',
                    node.isCurrentPath && !selected && 'border-primary/30',
                    !visible && 'opacity-70',
                  )}
                >
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      if (hasChildren) toggleExpanded(node.id);
                    }}
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted"
                  >
                    {hasChildren ? expanded.has(node.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 flex items-center gap-1">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', roleClass(node.role))}>
                        {roleLabel(node.role)}
                      </span>
                      {node.childIds.length > 1 ? (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                          {node.childIds.length} branches
                        </span>
                      ) : null}
                    </span>
                    <span className="block leading-snug">{visibleText(node.text, compact ? 90 : 150)}</span>
                  </span>
                </button>
              </div>
            );
          })}
          {!loading && flatNodes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No messages found.
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <Separator />

      <div className="space-y-2 p-3">
        <div className="text-xs text-muted-foreground">
          {selectedNode ? (
            <>
              Selected: <span className="font-medium text-foreground">{roleLabel(selectedNode.role)}</span>
              {branchCount > 1 ? ` · ${branchCount} child branches` : ''}
            </>
          ) : (
            'Select a node to edit or branch from it.'
          )}
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New message text for edit / branch reply…"
          className="h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-xs outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedNodeId || !draft.trim() || Boolean(busyAction)}
            onClick={() => selectedNodeId && void runAction('edit', () => api.editMessage(selectedNodeId, draft))}
          >
            {busyAction === 'edit' ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Edit3 className="mr-2 h-3 w-3" />}
            Edit
          </Button>
          <Button
            size="sm"
            disabled={!selectedNodeId || !draft.trim() || Boolean(busyAction)}
            onClick={() => selectedNodeId && void runAction('reply', () => api.submitReply(selectedNodeId, draft))}
          >
            {busyAction === 'reply' ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Send className="mr-2 h-3 w-3" />}
            Branch reply
          </Button>
        </div>
      </div>
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
