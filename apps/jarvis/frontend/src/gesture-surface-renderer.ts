import type { GestureContextAction } from './gesture-target-registry';
import type { CalibrationTarget } from './calibration';
import type { GestureState, Handedness, Point } from './tracking';

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

export interface GestureControlBindings {
  calibrate(handedness: Handedness): void;
  reset(): void;
  swap(): void;
  diagnostics(): void;
  exportDiagnostics(): void;
}

export interface GestureControlState {
  calibratedHands: Handedness[];
  swapped: boolean;
  diagnosticsEnabled: boolean;
}

export interface GestureCalibrationView {
  handedness: Handedness;
  target: CalibrationTarget;
  point: Point;
  message: string;
}

export interface GestureSurfacePort {
  render(view: GestureSurfaceView): void;
  setSystemStatus(status: string): void;
  showActionRing(point: Point, actions: readonly GestureContextAction[]): void;
  hideActionRing(): void;
  configureControls(bindings: GestureControlBindings): void;
  updateControlState(state: GestureControlState): void;
  showCalibration(view: GestureCalibrationView | null): void;
  showDiagnostics(contents: string | null): void;
  dispose(): void;
}

/** Imperative renderer confined to a fixed body overlay outside React's root. */
export class GestureSurfaceRenderer implements GestureSurfacePort {
  private surface: HTMLDivElement | null = null;
  private rightCursor: HTMLDivElement | null = null;
  private leftCursor: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private ring: HTMLDivElement | null = null;
  private controls: HTMLElement | null = null;
  private calibration: HTMLElement | null = null;
  private diagnostics: HTMLElement | null = null;
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
      button.dataset.gestureTarget = `runtime-action:${action.id}`;
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

  configureControls(bindings: GestureControlBindings): void {
    this.ensureMounted();
    this.controls?.remove();
    const controls = this.ownerDocument.createElement('nav');
    controls.className = 'jericho-runtime-controls';
    controls.setAttribute('aria-label', 'Local gesture controls');
    controls.append(
      controlButton(this.ownerDocument, 'calibrate-left', 'Calibrate left hand', () => bindings.calibrate('Left')),
      controlButton(this.ownerDocument, 'calibrate-right', 'Calibrate right hand', () => bindings.calibrate('Right')),
      controlButton(this.ownerDocument, 'reset', 'Reset hand calibration', bindings.reset),
      controlButton(this.ownerDocument, 'swap', 'Swap hand roles', bindings.swap),
      controlButton(this.ownerDocument, 'diagnostics', 'Toggle gesture diagnostics', bindings.diagnostics),
      controlButton(this.ownerDocument, 'export', 'Export sanitized diagnostics', bindings.exportDiagnostics),
    );
    this.surface!.append(controls);
    this.controls = controls;
  }

  updateControlState(state: GestureControlState): void {
    this.ensureMounted();
    const calibrated = new Set(state.calibratedHands);
    this.control('calibrate-left')?.classList.toggle('ready', calibrated.has('Left'));
    this.control('calibrate-right')?.classList.toggle('ready', calibrated.has('Right'));
    setPressed(this.control('swap'), state.swapped);
    setPressed(this.control('diagnostics'), state.diagnosticsEnabled);
  }

  showCalibration(view: GestureCalibrationView | null): void {
    this.ensureMounted();
    this.calibration?.remove();
    this.calibration = null;
    if (!view) return;
    const layer = this.ownerDocument.createElement('section');
    layer.className = 'jericho-runtime-calibration';
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'assertive');
    const copy = this.ownerDocument.createElement('p');
    copy.textContent = view.message;
    const target = this.ownerDocument.createElement('div');
    target.className = 'jericho-runtime-calibration-target';
    target.dataset.calibrationTarget = view.target;
    target.style.left = `${view.point.x * 100}%`;
    target.style.top = `${view.point.y * 100}%`;
    target.setAttribute('aria-hidden', 'true');
    layer.append(copy, target);
    this.surface!.append(layer);
    this.calibration = layer;
  }

  showDiagnostics(contents: string | null): void {
    this.ensureMounted();
    this.diagnostics?.remove();
    this.diagnostics = null;
    if (!contents) return;
    const panel = this.ownerDocument.createElement('pre');
    panel.className = 'jericho-runtime-diagnostics';
    panel.textContent = contents;
    this.surface!.append(panel);
    this.diagnostics = panel;
  }

  dispose(): void {
    this.hideActionRing();
    this.surface?.remove();
    this.surface = null;
    this.rightCursor = null;
    this.leftCursor = null;
    this.status = null;
    this.controls = null;
    this.calibration = null;
    this.diagnostics = null;
  }

  private ensureMounted() {
    if (this.surface?.isConnected) return;
    const surface = this.ownerDocument.createElement('div');
    surface.className = 'jericho-gesture-surface';
    const right = this.ownerDocument.createElement('div');
    right.className = 'jericho-gesture-cursor jericho-gesture-cursor--right';
    right.setAttribute('aria-hidden', 'true');
    const left = this.ownerDocument.createElement('div');
    left.className = 'jericho-gesture-cursor jericho-gesture-cursor--left';
    left.setAttribute('aria-hidden', 'true');
    const status = this.ownerDocument.createElement('div');
    status.className = 'jericho-gesture-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = this.lastStatus;
    surface.append(right, left, status);
    this.ownerDocument.body.append(surface);
    this.surface = surface;
    this.rightCursor = right;
    this.leftCursor = left;
    this.status = status;
  }

  private control(id: string): HTMLButtonElement | null {
    return this.controls?.querySelector<HTMLButtonElement>(`[data-runtime-control="${id}"]`) ?? null;
  }
}

function renderCursor(element: HTMLDivElement, view: GestureCursorView) {
  element.style.transform = `translate3d(${view.x}px, ${view.y}px, 0)`;
  element.classList.toggle('jericho-gesture-cursor--visible', view.visible);
  element.classList.toggle('jericho-gesture-cursor--pinch', view.mode === 'pinch');
  element.dataset.mode = view.mode;
}

function controlButton(
  ownerDocument: Document,
  id: string,
  label: string,
  invoke: () => void,
): HTMLButtonElement {
  const button = ownerDocument.createElement('button');
  button.type = 'button';
  button.dataset.runtimeControl = id;
  button.dataset.gestureTarget = `runtime-control:${id}`;
  button.setAttribute('aria-label', label);
  button.textContent = label;
  button.addEventListener('click', invoke);
  return button;
}

function setPressed(button: HTMLButtonElement | null, pressed: boolean): void {
  if (!button) return;
  button.classList.toggle('ready', pressed);
  button.setAttribute('aria-pressed', String(pressed));
}
