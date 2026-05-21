import type { AuthFetchBackgroundRequest, AuthFetchResponse, SupportedPlatform } from '@/src/auth/types';
import type { ConvoController } from '@/src/convo/ConvoController';
import type { ConvoSnapshot } from '@/src/convo/types';
import type { ApiResult, ChatGptConversationResponse, ConvoNode, ConvoTree, MessageRole } from '@/src/shared/types';
import { ensure, ensureNotNull } from '@/src/utils';
import {
  buildConvoSnapshotFromChatGptResponse,
  getChatGptConversationIdFromUrl,
} from './ChatGptConvoTreeBuilder';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForDomChange(root: Element | Document = document, timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | undefined;

    const observer = new MutationObserver((mutations) => {
      if (mutations.length > 0) {
        if (timer !== undefined) window.clearTimeout(timer);
        observer.disconnect();
        window.setTimeout(resolve, 80);
      }
    });

    timer = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
}

function triggerNativeEvents(element: Element | null | undefined): void {
  if (!element) return;
  const events = [
    'mouseover',
    'mouseenter',
    'mousemove',
    'mousedown',
    'mouseup',
    'click',
    'pointerover',
    'pointerenter',
    'pointerdown',
    'pointerup',
    'pointermove',
    'pointercancel',
    'focus',
    'focusin',
  ];

  for (const eventName of events) {
    try {
      element.dispatchEvent(
        new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } catch {
      // Ignore synthetic event failures. The following selector attempts report real failures.
    }
  }
}

function triggerDeep(element: Element, depth = 0): void {
  if (depth > 5) return;
  triggerNativeEvents(element);
  for (const child of Array.from(element.children)) triggerDeep(child, depth + 1);
}

function findChatGptMessageElement(nodeId: string): HTMLElement | null {
  // TODO: When selecting a node, we should select it by data-message-id
  // TODO: When constructing EditMsgBox, we should select the node by data-message-id, 
  // and then select the outer section box (or element in general) that contains a data-turn-id attribute. Note that
  // data-turn-id-container and data-message-id 
  return document.querySelector<HTMLElement>(`[data-turn-id-container="${CSS.escape(nodeId)}"]`);
}

function getChatGptMessageElement(nodeId: string): HTMLElement {
  const element = findChatGptMessageElement(nodeId);
  ensureNotNull(element, `Message element not found: ${nodeId}`);
  return element;
}

function getChatGptMessageContainer(messageElement: HTMLElement): HTMLElement {
  return messageElement.closest<HTMLElement>('article')
    ?? messageElement.parentElement?.parentElement
    ?? messageElement;
}

async function scrollToChatGptNode(nodeId: string): Promise<void> {
  const element = getChatGptMessageElement(nodeId);
  element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  await sleep(120);
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, text: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (valueSetter) {
    valueSetter.call(textarea, text);
  } else {
    textarea.value = text;
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function findEditButton(container: HTMLElement, role: MessageRole): HTMLButtonElement | undefined {
  const labelledButton = container.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]');
  if (labelledButton) return labelledButton;

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  const index = role === 'assistant' ? buttons.length - 7 : 1;
  return buttons[index];
}

async function editChatGptMessage(node: ConvoNode, text: string): Promise<void> {
  const messageElement = getChatGptMessageElement(node.id);
  const container = getChatGptMessageContainer(messageElement);

  let editButton: HTMLButtonElement | undefined;
  for (let attempt = 0; attempt < 50 && !editButton; attempt++) {
    triggerDeep(messageElement);
    editButton = findEditButton(container, node.role);
    if (!editButton) await sleep(100);
  }

  ensureNotNull(editButton, `Edit button not found for message ${node.id}`);
  editButton.click();
  await waitForDomChange(container);

  let textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  for (let attempt = 0; attempt < 5 && !textarea; attempt++) {
    await sleep(100);
    textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  }
  ensureNotNull(textarea, `Textarea not found after opening editor for message ${node.id}`);

  setNativeTextareaValue(textarea, text);
  messageElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

  let current: Element | null = textarea;
  let submitButton: HTMLButtonElement | null = null;
  for (let depth = 0; current && depth < 10 && !submitButton; depth++) {
    submitButton = Array.from(current.querySelectorAll<HTMLButtonElement>('button'))[1] ?? null;
    current = current.parentElement;
  }

  ensureNotNull(submitButton, `Send button not found for message ${node.id}`);
  submitButton.click();
  await waitForDomChange(container);
}

interface NavStep {
  execute(): Promise<void>;
}

class ScrollStep implements NavStep {
  constructor(private readonly nodeId: string) { }

  async execute(): Promise<void> {
    await scrollToChatGptNode(this.nodeId);
  }
}

class BranchNavBox {
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly counterEl: HTMLElement;

  constructor(private readonly nodeId: string) {
    const nodeElem = getChatGptMessageElement(nodeId);
    const prevBtn = nodeElem.querySelector<HTMLButtonElement>('button[aria-label="Previous response"]');
    ensureNotNull(prevBtn, `Can't find previous branch button in message node ${nodeId}`);
    this.prevBtn = prevBtn;

    const nextBtn = nodeElem.querySelector<HTMLButtonElement>('button[aria-label="Next response"]');
    ensureNotNull(nextBtn, `Can't find next branch button in message node ${nodeId}`);
    this.nextBtn = nextBtn;

    const navBox = prevBtn.parentElement;
    ensureNotNull(navBox, `Can't find branch nav box in message node ${nodeId}`);

    const counterEl = navBox.querySelector<HTMLElement>('.tabular-nums');
    ensureNotNull(counterEl, `Can't find branch counter in message node ${nodeId}`);
    this.counterEl = counterEl;
  }

  getCurBranchIdx(): number {
    const counterText = this.counterEl.textContent?.trim() ?? '';
    const match = counterText.match(/^(\d+)\s*\/\s*(\d+)$/);
    const curBranchIdx = match ? Number(match[1]) - 1 : null;
    ensureNotNull(curBranchIdx, `Failed to find current branch index for message ${this.nodeId}`);
    return curBranchIdx;
  }

  getTotalBranches(): number {
    const counterText = this.counterEl.textContent?.trim() ?? '';
    const match = counterText.match(/^(\d+)\s*\/\s*(\d+)$/);
    const totalBranches = match ? Number(match[2]) : null;
    ensureNotNull(totalBranches, `Failed to find total branches for message ${this.nodeId}`);
    return totalBranches;
  }

  clickPrev(): void {
    this.prevBtn.click();
  }

  clickNext(): void {
    this.nextBtn.click();
  }
}

class BranchStep implements NavStep {
  constructor(
    private readonly nodeId: string,
    private readonly targetBranchIdx: number,
    private readonly childCount: number,
  ) {
    ensure(
      targetBranchIdx >= 0 && targetBranchIdx < childCount,
      `Invalid branch target ${targetBranchIdx} for message ${nodeId}`,
    );
  }

  async execute(): Promise<void> {
    for (let attempt = 0; attempt < this.childCount + 4; attempt++) {
      const branchNavBox = new BranchNavBox(this.nodeId);
      const curBranchIdx = branchNavBox.getCurBranchIdx();
      const totalBranches = branchNavBox.getTotalBranches();

      ensure(
        this.childCount === totalBranches,
        `Stored branch count (${this.childCount}) does not match ChatGpt branch count (${totalBranches}) for message ${this.nodeId}`,
      );

      if (curBranchIdx === this.targetBranchIdx) return;

      if (curBranchIdx > this.targetBranchIdx) {
        branchNavBox.clickPrev();
      } else {
        branchNavBox.clickNext();
      }

      await waitForDomChange(document.querySelector('main') ?? document.body, 1200);
    }

    throw new Error(`Failed to switch message ${this.nodeId} to branch ${this.targetBranchIdx}`);
  }
}

class ChatGptHtmlMsgTree {
  constructor(private readonly tree: ConvoTree) { }

  computeNavPath(fromNodeId: string, toNodeId: string): NavStep[] {
    const fromPath = this.getPathToRoot(fromNodeId);
    const targetPath = this.getPathToRoot(toNodeId);
    const steps: NavStep[] = [];

    let divergenceIdx = 0;
    while (
      divergenceIdx < fromPath.length &&
      divergenceIdx < targetPath.length &&
      fromPath[divergenceIdx] === targetPath[divergenceIdx]
    ) {
      divergenceIdx += 1;
    }

    if (divergenceIdx > 0) {
      for (let index = divergenceIdx - 1; index < targetPath.length - 1; index++) {
        const parentId = targetPath[index];
        const childId = targetPath[index + 1];
        const parent = this.getNode(parentId);
        const targetBranchIdx = parent.childIds.indexOf(childId);
        ensure(targetBranchIdx >= 0, `Message ${childId} is not a child of message ${parentId}`);

        if (parent.childIds.length > 1) {
          steps.push(new ScrollStep(parentId));
          steps.push(new BranchStep(parentId, targetBranchIdx, parent.childIds.length));
        }
      }
    }

    steps.push(new ScrollStep(toNodeId));
    return steps;
  }

  private getPathToRoot(nodeId: string): string[] {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | null = nodeId;

    while (current) {
      ensure(!seen.has(current), `Cycle detected in ChatGpt conversation tree at message ${current}`);
      seen.add(current);
      const node = this.getNode(current);
      path.push(current);
      current = node.parentId;
    }

    return path.reverse();
  }

  private getNode(nodeId: string): ConvoNode {
    const node = this.tree.nodes[nodeId];
    ensureNotNull(node, `Message node ${nodeId} does not exist in the current conversation tree`);
    return node;
  }
}

export default class ChatGptConvoController implements ConvoController {
  readonly platformName: SupportedPlatform = 'chatgpt';

  private snapshot: ConvoSnapshot | null = null;

  getSnapshot(): ConvoSnapshot | null {
    return this.snapshot;
  }

  async syncConvo(): Promise<void> {
    const response = await this.fetchRawConversation();
    this.snapshot = buildConvoSnapshotFromChatGptResponse(response, location.href);
  }

  async navigateToNode(targetNodeId: string): Promise<void> {
    const snapshot = await this.ensureSnapshot();
    const curNodeId = snapshot.curNodeId;
    ensureNotNull(curNodeId, 'Cannot navigate because the current conversation node is unknown.');

    const navPath = new ChatGptHtmlMsgTree(snapshot.tree).computeNavPath(curNodeId, targetNodeId);
    for (const navStep of navPath) {
      await navStep.execute();
    }
  }

  async submitReply(parentNodeId: string, text: string): Promise<void> {
    const snapshot = await this.ensureSnapshot();
    const parent = snapshot.tree.nodes[parentNodeId];
    ensureNotNull(parent, `Unknown parent node ${parentNodeId}.`);
    const childId = parent.childIds[0];
    ensureNotNull(
      childId,
      'This MVP creates a branch by editing an existing child. Select a node whose parent already has a child response.',
    );

    const child = snapshot.tree.nodes[childId];
    ensureNotNull(child, `Unknown child node ${childId}.`);
    await this.navigateToNode(childId);
    await editChatGptMessage(child, text);
    this.snapshot = null;
  }

  private async ensureSnapshot(): Promise<ConvoSnapshot> {
    if (!this.snapshot) await this.syncConvo();
    ensureNotNull(this.snapshot, 'No conversation snapshot is available.');
    return this.snapshot;
  }

  private async fetchRawConversation(): Promise<ChatGptConversationResponse> {
    const conversationId = getChatGptConversationIdFromUrl();
    ensureNotNull(conversationId, 'Could not detect a ChatGpt conversation ID from this tab URL.');

    const response = (await browser.runtime.sendMessage({
      type: 'LLM_NAV_AUTH_FETCH',
      platform: 'chatgpt',
      payload: {
        url: `https://chatgpt.com/backend-api/conversation/${conversationId}`,
        method: 'GET',
      },
    } satisfies AuthFetchBackgroundRequest)) as ApiResult<AuthFetchResponse>;

    if (!response?.ok) throw new Error(response?.error ?? 'Failed to fetch ChatGpt conversation.');
    if (!response.data.ok) {
      throw new Error(`Failed to fetch ChatGpt conversation: ${response.data.status} ${response.data.statusText}`);
    }

    ensure(
      response.data.data !== null && typeof response.data.data === 'object',
      'ChatGpt conversation response was not an object.',
    );

    return response.data.data as ChatGptConversationResponse;
  }
}
