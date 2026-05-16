import type { BranchStep } from '@/src/shared/types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForDomChange(root: Element | Document = document, timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);

    const observer = new MutationObserver((mutations) => {
      if (mutations.length > 0) {
        window.clearTimeout(timer);
        observer.disconnect();
        window.setTimeout(resolve, 80);
      }
    });

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
      // Ignore synthetic event failures. The following selector attempts will report real failures.
    }
  }
}

function triggerDeep(element: Element, depth = 0): void {
  if (depth > 5) return;
  triggerNativeEvents(element);
  for (const child of Array.from(element.children)) triggerDeep(child, depth + 1);
}

export function findChatGptMessageElement(nodeId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(nodeId)}"]`);
}

export function getVisibleChatGptMessageIds(): Set<string> {
  return new Set(
    Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
      .map((element) => element.getAttribute('data-message-id'))
      .filter((id): id is string => Boolean(id)),
  );
}

export function checkMissingNodes(nodeIds: string[]): string[] {
  return nodeIds.filter((id) => !findChatGptMessageElement(id));
}

export async function scrollToChatGptNode(nodeId: string): Promise<boolean> {
  const element = findChatGptMessageElement(nodeId);
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  triggerNativeEvents(element);
  return true;
}

export async function executeChatGptBranchSteps(steps: BranchStep[]): Promise<void> {
  for (const step of steps) {
    const messageElement = findChatGptMessageElement(step.nodeId);
    if (!messageElement) throw new Error(`Element not found for nodeId: ${step.nodeId}`);

    triggerDeep(messageElement);
    const container = messageElement.parentElement?.parentElement;
    if (!container) throw new Error(`Button container not found for nodeId: ${step.nodeId}`);

    const pickButton = (): HTMLButtonElement | undefined => {
      if (step.role === 'assistant') {
        const switcher = container.querySelector(
          '.text-token-text-secondary.flex.items-center.justify-center',
        );
        const buttons = Array.from(switcher?.querySelectorAll('button') ?? []);
        return buttons[step.stepsLeft > 0 ? 0 : 1];
      }

      const buttons = Array.from(container.querySelectorAll('button'));
      return buttons[step.stepsLeft > 0 ? 2 : 3];
    };

    let button: HTMLButtonElement | undefined;
    for (let attempt = 0; attempt < 50 && !button; attempt++) {
      triggerDeep(messageElement);
      button = pickButton();
      if (!button) await sleep(100);
    }

    if (!button) throw new Error(`Navigation button not found for node: ${step.nodeId}`);
    button.click();
    await waitForDomChange(document.querySelector('main') ?? document.body);
  }
}

export async function editChatGptMessage(nodeId: string, text: string): Promise<void> {
  const messageElement = findChatGptMessageElement(nodeId);
  if (!messageElement) throw new Error(`Message element not found: ${nodeId}`);

  const container = messageElement.parentElement?.parentElement;
  if (!container) throw new Error('Button container not found');

  let editButton: HTMLButtonElement | undefined;
  for (let attempt = 0; attempt < 50 && !editButton; attempt++) {
    triggerDeep(messageElement);
    const buttons = Array.from(container.querySelectorAll('button'));
    const index = messageElement.getAttribute('data-message-author-role') === 'assistant'
      ? buttons.length - 7
      : 1;
    editButton = buttons[index];
    if (!editButton) await sleep(100);
  }

  if (!editButton) throw new Error('Edit button not found');
  editButton.click();
  await waitForDomChange(container);

  let textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  for (let attempt = 0; attempt < 5 && !textarea; attempt++) {
    await sleep(100);
    textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  }
  if (!textarea) throw new Error('Textarea not found after opening editor');

  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

  let current: Element | null = textarea;
  let submitButton: HTMLButtonElement | null = null;
  for (let depth = 0; current && depth < 10 && !submitButton; depth++) {
    submitButton = Array.from(current.querySelectorAll('button'))[1] ?? null;
    current = current.parentElement;
  }

  if (!submitButton) throw new Error('Send button not found');
  submitButton.click();
  await waitForDomChange(container);
}

export async function submitReplyByEditingVisibleChild(childrenIds: string[], text: string): Promise<void> {
  for (const childId of childrenIds) {
    if (findChatGptMessageElement(childId)) {
      await editChatGptMessage(childId, text);
      return;
    }
  }
  throw new Error('No visible child message found to edit/resubmit');
}

export function installNativeHoverWarmup(): void {
  const warmed = new Set<Element>();
  const warm = (element: Element) => {
    if (warmed.has(element)) return;
    triggerDeep(element);
    warmed.add(element);
  };

  const scan = () => {
    document.querySelectorAll('article[data-testid^="conversation-turn-"]').forEach(warm);
  };

  scan();
  const target = document.querySelector('main') ?? document.body;
  new MutationObserver(() => scan()).observe(target, { childList: true, subtree: true });
}
