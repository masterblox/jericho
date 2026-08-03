import { useCallback, useRef, type RefCallback } from 'react';

import { CARD_HIT_SLOP_PX, CARD_RELEASE_SLOP_PX, distanceToRect } from './hit-testing';
import type { Point } from './tracking';

export interface GestureContextAction {
  id: string;
  label: string;
  disabled?: boolean;
  invoke(): void;
}

export interface GestureTargetDescriptor {
  id: string;
  element: Element;
  draggable?: boolean;
  onTap?: () => void;
  onHold?: (point: Point) => void;
  onDragStart?: (point: Point) => void;
  onDragMove?: (point: Point, delta: Point) => void;
  onDragEnd?: (point: Point, cancelled: boolean) => void;
  actions?: () => readonly GestureContextAction[];
}

export type GestureTargetRegistration = Omit<GestureTargetDescriptor, 'element'>;

export interface ResolvedGestureTarget {
  id: string;
  element: Element;
  draggable: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  boundaryDistance: number;
  invokeTap(): void;
  invokeHold(point: Point): void;
  dragStart(point: Point): void;
  dragMove(point: Point, delta: Point): void;
  dragEnd(point: Point, cancelled: boolean): void;
  contextActions(): readonly GestureContextAction[];
}

interface RegistryEntry {
  generation: number;
  target: GestureTargetDescriptor;
}

/**
 * DOM-backed semantic target registry. Registrations are generation-bound so
 * an old React ref cleanup cannot remove a newer StrictMode registration.
 */
export class GestureTargetRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private nextGeneration = 0;
  private stickyId: string | null = null;

  constructor(private readonly ownerDocument: Document = document) {}

  register(target: GestureTargetDescriptor): () => void {
    const generation = ++this.nextGeneration;
    this.entries.set(target.id, { generation, target });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.entries.get(target.id);
      if (current?.generation !== generation) return;
      this.entries.delete(target.id);
      if (this.stickyId === target.id) this.stickyId = null;
    };
  }

  resolveAt(point: Point): ResolvedGestureTarget | null {
    if (this.stickyId) {
      const sticky = this.entries.get(this.stickyId);
      if (sticky?.target.element.isConnected) {
        const resolved = this.resolveEntry(sticky, point);
        if (resolved.boundaryDistance <= CARD_RELEASE_SLOP_PX) return resolved;
      }
      this.stickyId = null;
    }

    const candidates = [...this.entries.values()]
      .filter(({ target }) => target.element.isConnected)
      .map((entry) => ({ entry, resolved: this.resolveEntry(entry, point) }))
      .filter(({ resolved }) => resolved.boundaryDistance <= CARD_HIT_SLOP_PX);
    if (!candidates.length) return null;

    const stack = typeof this.ownerDocument.elementsFromPoint === 'function'
      ? this.ownerDocument.elementsFromPoint(point.x, point.y)
      : [];
    for (const element of stack) {
      let ancestor: Element | null = element;
      while (ancestor) {
        const topmost = candidates.find(({ entry }) => entry.target.element === ancestor);
        if (topmost) return this.acquire(topmost.resolved);
        ancestor = ancestor.parentElement;
      }
    }

    candidates.sort((a, b) =>
      a.resolved.boundaryDistance - b.resolved.boundaryDistance
      || b.entry.generation - a.entry.generation,
    );
    return this.acquire(candidates[0].resolved);
  }

  get(id: string): ResolvedGestureTarget | null {
    const entry = this.entries.get(id);
    return entry?.target.element.isConnected
      ? this.resolveEntry(entry, centerOf(entry.target.element.getBoundingClientRect()))
      : null;
  }

  lock(id: string): void {
    if (this.entries.has(id)) this.stickyId = id;
  }

  releaseSticky(): void {
    this.stickyId = null;
  }

  clear(): void {
    this.entries.clear();
    this.stickyId = null;
  }

  private resolveEntry(entry: RegistryEntry, point: Point): ResolvedGestureTarget {
    const { target } = entry;
    const rect = target.element.getBoundingClientRect();
    return {
      id: target.id,
      element: target.element,
      draggable: target.draggable === true,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      boundaryDistance: distanceToRect(point, rect),
      invokeTap: () => target.onTap?.(),
      invokeHold: (at) => target.onHold?.(at),
      dragStart: (at) => target.onDragStart?.(at),
      dragMove: (at, delta) => target.onDragMove?.(at, delta),
      dragEnd: (at, cancelled) => target.onDragEnd?.(at, cancelled),
      contextActions: () => target.actions?.() ?? [],
    };
  }

  private acquire(target: ResolvedGestureTarget): ResolvedGestureTarget {
    if (target.draggable) this.stickyId = target.id;
    return target;
  }
}

/** React callback-ref adapter with current callbacks and generation-safe cleanup. */
export function useGestureTarget<T extends HTMLElement = HTMLElement>(
  registry: GestureTargetRegistry,
  registration: GestureTargetRegistration,
): RefCallback<T> {
  const current = useRef(registration);
  current.current = registration;
  const unregister = useRef<(() => void) | null>(null);

  return useCallback((element: T | null) => {
    unregister.current?.();
    unregister.current = null;
    if (!element) return;
    unregister.current = registry.register({
      id: registration.id,
      element,
      draggable: registration.draggable,
      onTap: () => current.current.onTap?.(),
      onHold: (point) => current.current.onHold?.(point),
      onDragStart: (point) => current.current.onDragStart?.(point),
      onDragMove: (point, delta) => current.current.onDragMove?.(point, delta),
      onDragEnd: (point, cancelled) => current.current.onDragEnd?.(point, cancelled),
      actions: () => current.current.actions?.() ?? [],
    });
  }, [registration.draggable, registration.id, registry]);
}

/**
 * Transitional adapter for existing declarative `data-gesture-target` nodes.
 * It emits DOM events/clicks; it never writes layout or application state.
 */
export function observeDomGestureTargets(
  root: ParentNode,
  registry: GestureTargetRegistry,
): () => void {
  const registrations = new Map<Element, () => void>();
  const refresh = () => {
    const current = new Set(
      [...root.querySelectorAll<Element>('[data-gesture-target]')]
        .filter((element) => element.getAttribute('data-gesture-target')),
    );
    for (const [element, unregister] of registrations) {
      if (current.has(element)) continue;
      unregister();
      registrations.delete(element);
    }
    for (const element of current) {
      if (registrations.has(element)) continue;
      const id = element.getAttribute('data-gesture-target')!;
      const draggable = element.getAttribute('data-gesture-draggable') === 'true';
      registrations.set(element, registry.register({
        id,
        element,
        draggable,
        onTap: () => activateElement(element),
        onHold: (point) => element.dispatchEvent(new CustomEvent('jericho:context', {
          bubbles: true,
          detail: { targetId: id, point },
        })),
        ...(draggable ? {
          onDragStart: (point) => dispatchGestureEvent(element, 'jericho:drag-start', {
            targetId: id, point: { ...point },
          }),
          onDragMove: (point, delta) => dispatchGestureEvent(element, 'jericho:drag-move', {
            targetId: id, point: { ...point }, delta: { ...delta },
          }),
          onDragEnd: (point, cancelled) => dispatchGestureEvent(element, 'jericho:drag-end', {
            targetId: id, point: { ...point }, cancelled,
          }),
        } : {}),
        actions: () => actionsFor(element, id),
      }));
    }
  };
  refresh();

  const MutationObserverType = root.ownerDocument?.defaultView?.MutationObserver;
  const observer = MutationObserverType ? new MutationObserverType(refresh) : null;
  observer?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-gesture-target'] });
  return () => {
    observer?.disconnect();
    for (const unregister of registrations.values()) unregister();
    registrations.clear();
  };
}

function dispatchGestureEvent(
  element: Element,
  type: string,
  detail: Record<string, unknown>,
): void {
  element.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
}

function actionsFor(element: Element, targetId: string): GestureContextAction[] {
  const buttons = [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (element instanceof HTMLButtonElement && !element.disabled) buttons.unshift(element);
  return [...new Set(buttons)].map((button, index) => ({
    id: `${targetId}:action:${index}`,
    label: button.textContent?.trim() || button.getAttribute('aria-label') || 'Open',
    invoke: () => button.click(),
  }));
}

function activateElement(element: Element) {
  if (element instanceof HTMLButtonElement) {
    element.click();
    return;
  }
  if (element.getAttribute('role') === 'button') {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return;
  }
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    element.focus({ preventScroll: true });
  }
}

function centerOf(rect: DOMRect): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}
