import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import ConversationNavigator from '@/src/ui/ConversationNavigator';
import type { NavigatorApi } from '@/src/ui/ConversationNavigator';
import { editMessage, fetchNavigatorSnapshot, navigateToNode, submitReply } from './chatgptContentApi';

type Position = {
  x: number;
  y: number;
};

const STORAGE_KEY = 'llm-chat-navigator:floating-button-position';

const BUTTON_SIZE = 48;
const MARGIN = 12;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 620;

const contentApi: NavigatorApi = {
  fetchSnapshot: fetchNavigatorSnapshot,
  navigateToNode,
  editMessage,
  submitReply,
};

function getDefaultPosition(): Position {
  return {
    x: window.innerWidth - BUTTON_SIZE - 24,
    y: Math.round(window.innerHeight * 0.45),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampPosition(position: Position): Position {
  return {
    x: clamp(position.x, MARGIN, window.innerWidth - BUTTON_SIZE - MARGIN),
    y: clamp(position.y, MARGIN, window.innerHeight - BUTTON_SIZE - MARGIN),
  };
}

export default function ChatGptFloatingUi() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>(() => getDefaultPosition());

  const latestPositionRef = useRef(position);

  const dragRef = useRef({
    dragging: false,
    moved: false,
    startPointerX: 0,
    startPointerY: 0,
    startX: 0,
    startY: 0,
  });

  useEffect(() => {
    latestPositionRef.current = position;
  }, [position]);

  useEffect(() => {
    async function loadSavedPosition() {
      const result = await browser.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY] as Position | undefined;
      if (saved) setPosition(clampPosition(saved));
    }
    void loadSavedPosition();
  }, []);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => clampPosition(current));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const panelPosition = useMemo(() => {
    const buttonIsOnRightHalf = position.x > window.innerWidth / 2;
    const left = buttonIsOnRightHalf ? position.x - PANEL_WIDTH - 12 : position.x + BUTTON_SIZE + 12;
    const top = position.y - 80;

    return {
      left: clamp(left, MARGIN, window.innerWidth - PANEL_WIDTH - MARGIN),
      top: clamp(top, MARGIN, window.innerHeight - PANEL_HEIGHT - MARGIN),
    };
  }, [position]);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      dragging: true,
      moved: false,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: position.x,
      startY: position.y,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag.dragging) return;

    const dx = event.clientX - drag.startPointerX;
    const dy = event.clientY - drag.startPointerY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

    setPosition(clampPosition({ x: drag.startX + dx, y: drag.startY + dy }));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.dragging = false;

    void browser.storage.local.set({ [STORAGE_KEY]: latestPositionRef.current });
    if (!drag.moved) setOpen((value) => !value);
  }

  return (
    <div className="fixed inset-0 z-[2147483647] pointer-events-none">
      <Button
        type="button"
        size="icon"
        aria-label="Toggle LLM Chat Navigator"
        className="pointer-events-auto fixed h-12 w-12 rounded-full shadow-xl select-none cursor-grab active:cursor-grabbing"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        Tree
      </Button>

      {open ? (
        <Card
          className="pointer-events-auto fixed h-[620px] w-[420px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-hidden shadow-2xl"
          style={{ left: panelPosition.left, top: panelPosition.top }}
        >
          <ConversationNavigator api={contentApi} compact />
        </Card>
      ) : null}
    </div>
  );
}
