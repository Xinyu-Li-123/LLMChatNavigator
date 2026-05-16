import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  defaultProviderUiConfig,
  loadProviderUiConfig,
  saveProviderUiConfig,
  type FloatingPaneConfig,
  type PaneSide,
  type Position,
  type ProviderUiConfig,
} from '@/src/shared/navigatorUiConfig';
import ConversationNavigator from '@/src/ui/ConversationNavigator';
import type { NavigatorApi } from '@/src/ui/ConversationNavigator';
import { editMessage, fetchNavigatorSnapshot, navigateToNode, submitReply } from './chatgptContentApi';

type PaneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ResizeDirection = {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
};

type ResizeHandle = ResizeDirection & {
  key: string;
  className: string;
};

const LEGACY_BUTTON_POSITION_STORAGE_KEY = 'llm-chat-navigator:floating-button-position';

const PROVIDER = 'chatgpt';
const BUTTON_SIZE = 48;
const MARGIN = 12;
const PANE_GAP = 12;
const MIN_PANE_WIDTH = 320;
const MIN_PANE_HEIGHT = 360;

const RESIZE_HANDLES: ResizeHandle[] = [
  { key: 'top', x: 0, y: -1, className: 'left-3 right-3 top-0 h-2 cursor-ns-resize' },
  { key: 'right', x: 1, y: 0, className: 'bottom-3 right-0 top-3 w-2 cursor-ew-resize' },
  { key: 'bottom', x: 0, y: 1, className: 'bottom-0 left-3 right-3 h-2 cursor-ns-resize' },
  { key: 'left', x: -1, y: 0, className: 'bottom-3 left-0 top-3 w-2 cursor-ew-resize' },
  { key: 'top-left', x: -1, y: -1, className: 'left-0 top-0 h-4 w-4 cursor-nwse-resize' },
  { key: 'top-right', x: 1, y: -1, className: 'right-0 top-0 h-4 w-4 cursor-nesw-resize' },
  { key: 'bottom-right', x: 1, y: 1, className: 'bottom-0 right-0 h-4 w-4 cursor-nwse-resize' },
  { key: 'bottom-left', x: -1, y: 1, className: 'bottom-0 left-0 h-4 w-4 cursor-nesw-resize' },
];

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

function maxPaneWidth() {
  return Math.max(MIN_PANE_WIDTH, window.innerWidth - MARGIN * 2);
}

function maxPaneHeight() {
  return Math.max(MIN_PANE_HEIGHT, window.innerHeight - MARGIN * 2);
}

function clampPaneSize(width: number, height: number) {
  return {
    width: clamp(width, MIN_PANE_WIDTH, maxPaneWidth()),
    height: clamp(height, MIN_PANE_HEIGHT, maxPaneHeight()),
  };
}

function clampPosition(position: Position): Position {
  return {
    x: clamp(position.x, MARGIN, window.innerWidth - BUTTON_SIZE - MARGIN),
    y: clamp(position.y, MARGIN, window.innerHeight - BUTTON_SIZE - MARGIN),
  };
}

function clampPaneRect(rect: PaneRect): PaneRect {
  const size = clampPaneSize(rect.width, rect.height);

  return {
    width: size.width,
    height: size.height,
    left: clamp(rect.left, MARGIN, window.innerWidth - size.width - MARGIN),
    top: clamp(rect.top, MARGIN, window.innerHeight - size.height - MARGIN),
  };
}

function resolvedPaneSide(buttonPosition: Position, side: PaneSide): 'left' | 'right' {
  if (side === 'left' || side === 'right') return side;
  return buttonPosition.x > window.innerWidth / 2 ? 'left' : 'right';
}

function anchoredPaneRect(buttonPosition: Position, pane: FloatingPaneConfig): PaneRect {
  const size = clampPaneSize(pane.width, pane.height);
  const side = resolvedPaneSide(buttonPosition, pane.side);
  const left = side === 'left'
    ? buttonPosition.x - size.width - PANE_GAP
    : buttonPosition.x + BUTTON_SIZE + PANE_GAP;

  return clampPaneRect({
    left,
    top: buttonPosition.y - 80,
    width: size.width,
    height: size.height,
  });
}

function paneRectFromConfig(buttonPosition: Position, pane: FloatingPaneConfig): PaneRect {
  if (pane.position) {
    return clampPaneRect({
      left: pane.position.x,
      top: pane.position.y,
      width: pane.width,
      height: pane.height,
    });
  }

  return anchoredPaneRect(buttonPosition, pane);
}

function providerConfigFromState(
  buttonPosition: Position,
  paneRect: PaneRect,
  side: PaneSide,
): ProviderUiConfig {
  return {
    floatingButtonPosition: buttonPosition,
    pane: {
      width: paneRect.width,
      height: paneRect.height,
      position: {
        x: paneRect.left,
        y: paneRect.top,
      },
      side,
    },
  };
}

function resizePaneRect(startRect: PaneRect, startPointer: Position, pointer: Position, direction: ResizeDirection) {
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;
  let { left, top, width, height } = startRect;

  if (direction.x < 0) {
    const right = startRect.left + startRect.width;
    width = clamp(startRect.width - dx, MIN_PANE_WIDTH, maxPaneWidth());
    left = right - width;
  } else if (direction.x > 0) {
    width = clamp(startRect.width + dx, MIN_PANE_WIDTH, maxPaneWidth());
  }

  if (direction.y < 0) {
    const bottom = startRect.top + startRect.height;
    height = clamp(startRect.height - dy, MIN_PANE_HEIGHT, maxPaneHeight());
    top = bottom - height;
  } else if (direction.y > 0) {
    height = clamp(startRect.height + dy, MIN_PANE_HEIGHT, maxPaneHeight());
  }

  return clampPaneRect({ left, top, width, height });
}

async function loadLegacyButtonPosition(): Promise<Position | null> {
  const result = await browser.storage.local.get(LEGACY_BUTTON_POSITION_STORAGE_KEY);
  const saved = result[LEGACY_BUTTON_POSITION_STORAGE_KEY] as Position | undefined;
  return typeof saved?.x === 'number' && typeof saved?.y === 'number' ? saved : null;
}

export default function ChatGptFloatingUi() {
  const defaultConfig = useMemo(() => defaultProviderUiConfig(), []);
  const defaultButtonPosition = useMemo(() => getDefaultPosition(), []);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>(() => defaultButtonPosition);
  const [paneRect, setPaneRect] = useState<PaneRect>(() => paneRectFromConfig(defaultButtonPosition, defaultConfig.pane));
  const [paneSide, setPaneSide] = useState<PaneSide>(defaultConfig.pane.side);

  const latestStateRef = useRef({
    position,
    paneRect,
    paneSide,
  });

  const dragRef = useRef({
    dragging: false,
    moved: false,
    startPointerX: 0,
    startPointerY: 0,
    startX: 0,
    startY: 0,
  });

  const resizeRef = useRef<{
    resizing: boolean;
    direction: ResizeDirection;
    startPointer: Position;
    startRect: PaneRect;
  }>({
    resizing: false,
    direction: { x: 0, y: 0 },
    startPointer: { x: 0, y: 0 },
    startRect: paneRect,
  });

  useEffect(() => {
    latestStateRef.current = { position, paneRect, paneSide };
  }, [paneRect, paneSide, position]);

  useEffect(() => {
    async function loadSavedConfig() {
      const [savedConfig, legacyPosition] = await Promise.all([
        loadProviderUiConfig(PROVIDER),
        loadLegacyButtonPosition(),
      ]);
      const nextPosition = clampPosition(savedConfig.floatingButtonPosition ?? legacyPosition ?? getDefaultPosition());
      const nextPaneRect = paneRectFromConfig(nextPosition, savedConfig.pane);
      setPosition(nextPosition);
      setPaneSide(savedConfig.pane.side);
      setPaneRect(nextPaneRect);
      latestStateRef.current = {
        position: nextPosition,
        paneRect: nextPaneRect,
        paneSide: savedConfig.pane.side,
      };
    }

    void loadSavedConfig();
  }, []);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => {
        const next = clampPosition(current);
        latestStateRef.current = { ...latestStateRef.current, position: next };
        return next;
      });
      setPaneRect((current) => {
        const next = clampPaneRect(current);
        latestStateRef.current = { ...latestStateRef.current, paneRect: next };
        return next;
      });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  function persistCurrentState() {
    const latest = latestStateRef.current;
    void saveProviderUiConfig(PROVIDER, providerConfigFromState(latest.position, latest.paneRect, latest.paneSide));
  }

  function handleButtonPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
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

  function handleButtonPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag.dragging) return;

    const dx = event.clientX - drag.startPointerX;
    const dy = event.clientY - drag.startPointerY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

    const nextPosition = clampPosition({ x: drag.startX + dx, y: drag.startY + dy });
    latestStateRef.current = { ...latestStateRef.current, position: nextPosition };
    setPosition(nextPosition);

    if (open) {
      const nextPaneRect = anchoredPaneRect(nextPosition, {
        width: latestStateRef.current.paneRect.width,
        height: latestStateRef.current.paneRect.height,
        position: null,
        side: paneSide,
      });
      latestStateRef.current = {
        ...latestStateRef.current,
        paneRect: nextPaneRect,
      };
      setPaneRect(nextPaneRect);
    }
  }

  function handleButtonPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.dragging = false;

    persistCurrentState();
    if (!drag.moved) setOpen((value) => !value);
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    direction: ResizeDirection,
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    resizeRef.current = {
      resizing: true,
      direction,
      startPointer: {
        x: event.clientX,
        y: event.clientY,
      },
      startRect: paneRect,
    };
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize.resizing) return;

    event.preventDefault();
    event.stopPropagation();
    const nextPaneRect = resizePaneRect(
      resize.startRect,
      resize.startPointer,
      { x: event.clientX, y: event.clientY },
      resize.direction,
    );
    latestStateRef.current = { ...latestStateRef.current, paneRect: nextPaneRect };
    setPaneRect(nextPaneRect);
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current.resizing) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current.resizing = false;
    persistCurrentState();
  }

  return (
    <div className="fixed inset-0 z-[2147483647] pointer-events-none">
      <Button
        type="button"
        size="icon"
        aria-label="Toggle LLM Chat Navigator"
        className="pointer-events-auto fixed h-12 w-12 rounded-full shadow-xl select-none cursor-grab active:cursor-grabbing"
        style={{ left: position.x, top: position.y }}
        onPointerDown={handleButtonPointerDown}
        onPointerMove={handleButtonPointerMove}
        onPointerUp={handleButtonPointerUp}
      >
        Tree
      </Button>

      {open ? (
        <Card
          className="pointer-events-auto fixed overflow-hidden bg-background text-foreground shadow-2xl"
          style={{
            left: paneRect.left,
            top: paneRect.top,
            width: paneRect.width,
            height: paneRect.height,
          }}
        >
          <div className="h-full w-full overflow-hidden bg-background">
            <ConversationNavigator api={contentApi} compact />
          </div>

          {RESIZE_HANDLES.map((handle) => (
            <div
              key={handle.key}
              aria-label={`Resize ${handle.key}`}
              className={cn('absolute z-40 touch-none bg-transparent', handle.className)}
              role="separator"
              onPointerDown={(event) => handleResizePointerDown(event, handle)}
              onPointerMove={handleResizePointerMove}
              onPointerUp={handleResizePointerUp}
              onPointerCancel={handleResizePointerUp}
            />
          ))}
        </Card>
      ) : null}
    </div>
  );
}
