import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FolderTree, Maximize2, Minimize2, Minus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  defaultExtensionUiConfig,
  defaultProviderUiConfig,
  loadExtensionUiConfig,
  loadProviderUiConfig,
  saveExtensionUiConfig,
  saveProviderUiConfig,
  type FloatingPaneConfig,
  type NavigatorTheme,
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

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
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

function fullscreenPaneRect(): PaneRect {
  return {
    left: MARGIN,
    top: MARGIN,
    width: window.innerWidth - MARGIN * 2,
    height: window.innerHeight - MARGIN * 2,
  };
}

function defaultRightPaneRect(pane: FloatingPaneConfig): PaneRect {
  const size = clampPaneSize(pane.width, pane.height);

  return clampPaneRect({
    left: window.innerWidth - size.width - MARGIN,
    top: MARGIN,
    width: size.width,
    height: Math.max(size.height, window.innerHeight - MARGIN * 2),
  });
}

function paneRectFromConfig(pane: FloatingPaneConfig): PaneRect {
  const size = clampPaneSize(pane.width, pane.height);
  if (pane.position) {
    return clampPaneRect({
      left: pane.position.x,
      top: pane.position.y,
      width: size.width,
      height: size.height,
    });
  }

  return defaultRightPaneRect(pane);
}

function providerConfigFromState(
  buttonPosition: Position,
  paneRect: PaneRect,
  side: PaneSide,
  includePanePosition: boolean,
): ProviderUiConfig {
  return {
    floatingButtonPosition: buttonPosition,
    pane: {
      width: paneRect.width,
      height: paneRect.height,
      position: includePanePosition ? {
        x: paneRect.left,
        y: paneRect.top,
      } : null,
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
  const defaultExtensionConfig = useMemo(() => defaultExtensionUiConfig(), []);
  const defaultConfig = useMemo(() => defaultProviderUiConfig(), []);
  const defaultButtonPosition = useMemo(() => getDefaultPosition(), []);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [theme, setTheme] = useState<NavigatorTheme>(defaultExtensionConfig.theme);
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark());
  const [conversationTitle, setConversationTitle] = useState('Current conversation');
  const [utilityRowCollapsed, setUtilityRowCollapsed] = useState(defaultExtensionConfig.utilityRowCollapsed);
  const [position, setPosition] = useState<Position>(() => defaultButtonPosition);
  const [paneRect, setPaneRect] = useState<PaneRect>(() => paneRectFromConfig(defaultConfig.pane));
  const [paneSide, setPaneSide] = useState<PaneSide>(defaultConfig.pane.side);
  const [fullscreen, setFullscreen] = useState(false);
  const restorePaneRectRef = useRef<PaneRect | null>(null);
  const panePositionSavedRef = useRef(Boolean(defaultConfig.pane.position));

  const latestStateRef = useRef({
    position,
    paneRect,
    paneSide,
  });

  const dragRef = useRef({
    dragging: false,
    moved: false,
    mode: 'button' as 'button' | 'pane',
    startPointerX: 0,
    startPointerY: 0,
    startX: 0,
    startY: 0,
    startPaneLeft: 0,
    startPaneTop: 0,
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
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    async function loadSavedConfig() {
      const [savedExtensionConfig, savedConfig, legacyPosition] = await Promise.all([
        loadExtensionUiConfig(),
        loadProviderUiConfig(PROVIDER),
        loadLegacyButtonPosition(),
      ]);
      const nextPosition = clampPosition(savedConfig.floatingButtonPosition ?? legacyPosition ?? getDefaultPosition());
      const nextPaneRect = paneRectFromConfig(savedConfig.pane);
      setTheme(savedExtensionConfig.theme);
      setUtilityRowCollapsed(savedExtensionConfig.utilityRowCollapsed);
      setPosition(nextPosition);
      setPaneSide(savedConfig.pane.side);
      setPaneRect(nextPaneRect);
      panePositionSavedRef.current = Boolean(savedConfig.pane.position);
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

  function persistCurrentState(savePanePosition = false) {
    if (savePanePosition) panePositionSavedRef.current = true;
    const latest = latestStateRef.current;
    void saveProviderUiConfig(
      PROVIDER,
      providerConfigFromState(
        latest.position,
        latest.paneRect,
        latest.paneSide,
        panePositionSavedRef.current,
      ),
    );
  }

  function handleThemeChange(next: NavigatorTheme) {
    setTheme(next);
    void saveExtensionUiConfig({ theme: next, utilityRowCollapsed });
  }

  function handleUtilityRowCollapsedChange(collapsed: boolean) {
    setUtilityRowCollapsed(collapsed);
    void saveExtensionUiConfig({ theme, utilityRowCollapsed: collapsed });
  }

  function handleDragPointerDown(event: ReactPointerEvent<HTMLElement>, mode: 'button' | 'pane') {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      dragging: true,
      moved: false,
      mode,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: position.x,
      startY: position.y,
      startPaneLeft: paneRect.left,
      startPaneTop: paneRect.top,
    };
  }

  function handleDragPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag.dragging) return;

    const dx = event.clientX - drag.startPointerX;
    const dy = event.clientY - drag.startPointerY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

    if (drag.mode === 'button') {
      const nextPosition = clampPosition({ x: drag.startX + dx, y: drag.startY + dy });
      latestStateRef.current = { ...latestStateRef.current, position: nextPosition };
      setPosition(nextPosition);
      return;
    }

    const nextPaneRect = clampPaneRect({
      ...latestStateRef.current.paneRect,
      left: drag.startPaneLeft + dx,
      top: drag.startPaneTop + dy,
    });
    latestStateRef.current = { ...latestStateRef.current, paneRect: nextPaneRect };
    setFullscreen(false);
    setPaneRect(nextPaneRect);
  }

  function handleDragPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.dragging = false;

    persistCurrentState(drag.mode === 'pane' && drag.moved);
    if (!drag.moved) {
      if (drag.mode === 'button' && !open) {
        setHasOpened(true);
        setOpen(true);
      }
    }
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
    setFullscreen(false);
    setPaneRect(nextPaneRect);
  }

  function handleResizePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeRef.current.resizing) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current.resizing = false;
    persistCurrentState(true);
  }

  function handleCollapse() {
    setOpen(false);
    persistCurrentState();
  }

  function handleFullscreenToggle() {
    if (fullscreen && restorePaneRectRef.current) {
      const nextPaneRect = clampPaneRect(restorePaneRectRef.current);
      latestStateRef.current = { ...latestStateRef.current, paneRect: nextPaneRect };
      setPaneRect(nextPaneRect);
      setFullscreen(false);
      persistCurrentState(true);
      return;
    }

    restorePaneRectRef.current = latestStateRef.current.paneRect;
    const nextPaneRect = fullscreenPaneRect();
    latestStateRef.current = { ...latestStateRef.current, paneRect: nextPaneRect };
    setPaneRect(nextPaneRect);
    setFullscreen(true);
    persistCurrentState(true);
  }

  function stopControlPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  const resolvedDarkMode = theme === 'dark' || (theme === 'auto' && prefersDark);

  return (
    <div className={cn('fixed inset-0 z-[2147483647] pointer-events-none', resolvedDarkMode && 'dark')}>
      {!open ? (
        <Button
          type="button"
          size="icon"
          aria-label="Open LLM Chat Navigator"
          title="Open LLM Chat Navigator"
          className="pointer-events-auto fixed h-12 w-12 rounded-none bg-background text-foreground shadow-xl select-none cursor-grab active:cursor-grabbing hover:bg-background rounded-md"
          style={{ left: position.x, top: position.y }}
          onPointerDown={(event) => handleDragPointerDown(event, 'button')}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
          onPointerCancel={handleDragPointerUp}
        >
          <FolderTree className="h-5 w-5" />
        </Button>
      ) : null}

      {hasOpened ? (
        <Card
          className="pointer-events-auto fixed flex flex-col overflow-hidden bg-background text-foreground shadow-2xl"
          style={{
            left: paneRect.left,
            top: paneRect.top,
            width: paneRect.width,
            height: paneRect.height,
            display: open ? undefined : 'none',
          }}
        >
          <div
            className="flex h-11 shrink-0 cursor-grab select-none items-center gap-2 border-b bg-background px-3 active:cursor-grabbing"
            onPointerDown={(event) => handleDragPointerDown(event, 'pane')}
            onPointerMove={handleDragPointerMove}
            onPointerUp={handleDragPointerUp}
            onPointerCancel={handleDragPointerUp}
          >
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{conversationTitle}</div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Collapse LLM Chat Navigator"
              title="Collapse"
              className="h-8 w-8 cursor-pointer"
              onPointerDown={stopControlPointerDown}
              onClick={handleCollapse}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={fullscreen ? 'Restore LLM Chat Navigator' : 'Fullscreen LLM Chat Navigator'}
              title={fullscreen ? 'Restore' : 'Fullscreen'}
              className="h-8 w-8 cursor-pointer"
              onPointerDown={stopControlPointerDown}
              onClick={handleFullscreenToggle}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-background">
            <ConversationNavigator
              api={contentApi}
              compact
              theme={theme}
              onThemeChange={handleThemeChange}
              utilityRowCollapsed={utilityRowCollapsed}
              onUtilityRowCollapsedChange={handleUtilityRowCollapsedChange}
              onTitleChange={setConversationTitle}
            />
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
