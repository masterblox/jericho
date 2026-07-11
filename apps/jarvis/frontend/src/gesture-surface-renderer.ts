import type { GestureContextAction } from './gesture-target-registry';
import type { GestureState, Point } from './tracking';

export interface GestureCursorView {
  visible: boolean;
  x: number;
  y: number;
  mode: GestureState;
}

export interface GestureSurfaceView {
  right: GestureCursorView;
  left: GestureCursorView;
  status: string;
}

export interface GestureSurfacePort {
  render(view: GestureSurfaceView): void;
  setSystemStatus(status: string): void;
  showActionRing(point: Point, actions: readonly GestureContextAction[]): void;
  hideActionRing(): void;
  dispose(): void;
}

/** Imperative renderer confined to a fixed body overlay outside React's root. */
export class GestureSurfaceRenderer implements GestureSurfacePort {
  private surface: HTMLDivElement | null = null;
  private rightCursor: HTMLDivElement | null = null;
  private leftCursor: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private ring: HTMLDivElement | null = null;
  private lastStatus = 'gesture runtime standby';

  constructor(private readonly ownerDocument: Document = document) {}

  render(view: GestureSurfaceView): void {
    this.ensureMounted();
    renderCursor(this.rightCursor!, view.right);
    renderCursor(this.leftCursor!, view.left);
    this.setSystemStatus(view.status);
  }

  setSystemStatus(status: string): void {
    this.lastStatus = status;
    this.ensureMounted();
    this.status!.textContent = status;
  }

  showActionRing(point: Point, actions: readonly GestureContextAction[]): void {
    this.ensureMounted();
    this.hideActionRing();
    if (!actions.length) return;
    const ring = this.ownerDocument.createElement('div');
    ring.className = 'jericho-action-ring';
    ring.setAttribute('role', 'menu');
    ring.setAttribute('aria-label', 'Context actions');
    ring.style.left = `${point.x}px`;
    ring.style.top = `${point.y}px`;
    actions.forEach((action, index) => {
      const button = this.ownerDocument.createElement('button');
      button.type = 'button';
      button.dataset.gestureAction = action.id;
      button.disabled = action.disabled === true;
      button.textContent = action.label;
      button.style.setProperty('--jericho-ring-index', String(index));
      button.style.setProperty('--jericho-ring-count', String(actions.length));
      button.addEventListener('click', () => {
        action.invoke();
        this.hideActionRing();
      }, { once: true });
      ring.append(button);
    });
    this.surface!.append(ring);
    this.ring = ring;
  }

  hideActionRing(): void {
    this.ring?.remove();
    this.ring = null;
  }

  dispose(): void {
    this.hideActionRing();
    this.surface?.remove();
    this.surface = null;
    this.rightCursor = null;
    this.leftCursor = null;
    this.status = null;
  }

  private ensureMounted() {
    if (this.surface?.isConnected) return;
    const surface = this.ownerDocument.createElement('div');
    surface.className = 'jericho-gesture-surface';
    surface.setAttribute('aria-hidden', 'true');
    const right = this.ownerDocument.createElement('div');
    right.className = 'jericho-gesture-cursor jericho-gesture-cursor--right';
    const left = this.ownerDocument.createElement('div');
    left.className = 'jericho-gesture-cursor jericho-gesture-cursor--left';
    const status = this.ownerDocument.createElement('div');
    status.className = 'jericho-gesture-status';
    status.textContent = this.lastStatus;
    surface.append(right, left, status);
    this.ownerDocument.body.append(surface);
    this.surface = surface;
    this.rightCursor = right;
    this.leftCursor = left;
    this.status = status;
  }
}

function renderCursor(element: HTMLDivElement, view: GestureCursorView) {
  element.style.transform = `translate3d(${view.x}px, ${view.y}px, 0)`;
  element.classList.toggle('jericho-gesture-cursor--visible', view.visible);
  element.classList.toggle('jericho-gesture-cursor--pinch', view.mode === 'pinch');
  element.dataset.mode = view.mode;
}
