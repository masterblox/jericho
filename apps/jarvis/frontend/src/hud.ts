import {
  CALIBRATION_ORDER,
  TARGET_POINTS,
  StableSampleBuffer,
  applyCalibration,
  createCalibrationProfile,
  loadCalibration,
  resetCalibrations,
  saveCalibration,
  type CalibrationProfile,
  type CalibrationSample,
} from './calibration';
import { mapHandToScreen } from './coords';
import { DiagnosticRecorder } from './diagnostics';
import { captureDragLayout, finishDragLayout, type DragLayoutOrigin } from './drag-layout';
import { GestureCoordinator, type CoordinatorAction } from './gesture-coordinator';
import { nearestCardHit } from './hit-testing';
import type { GestureFrame, Handedness, Landmark, TrackedHandFrame } from './gestures';
import type { PointerAction, PointerTarget } from './pointer-controller';
import type { Point } from './tracking';

interface Task {
  title: string;
  status: 'queued' | 'working' | 'done';
}

const SAMPLE_TASKS: Task[] = [
  { title: 'Draft reply — Michael (APL)', status: 'queued' },
  { title: 'Pull open Paperclip issues', status: 'working' },
  { title: 'Summarize Jericho nightly brief', status: 'done' },
];

const NAV_COMMANDS = [
  ['DRAFT', 'draft an email'], ['TASKS', 'list open tasks'], ['FLEET', 'fleet status'],
  ['DEV', 'dispatch to DEV lane'], ['IRIS', 'request Iris design'], ['PA', 'check PA calendar'],
  ['DONALD', 'sales pipeline'], ['JERICHO', 'escalate to Jericho'],
  ['PAPERCLIP', 'pull Paperclip queue'], ['SEARCH', 'research a topic'],
  ['SUMMARIZE', 'summarize document'], ['SCHEDULE', 'schedule meeting'],
  ['REPLY', 'reply to thread'], ['CALL', 'place a call'], ['REMIND', 'set a reminder'],
  ['REPORT', 'generate report'], ['IMAGE', 'generate an image'], ['TRANSLATE', 'translate text'],
  ['BRIEF', 'morning brief'], ['DEPLOY', 'deploy changes'],
] as const;

const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export class HUD {
  private readonly rightCursor: HTMLElement;
  private readonly leftCursor: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly coordinator = new GestureCoordinator();
  private readonly recorder = new DiagnosticRecorder();
  private readonly cards: HTMLElement[] = [];
  private selected = -1;
  private selectionBeforeGrab: number | null = null;
  private grabPreviewId: string | null = null;
  private readonly dragOrigins = new Map<string, DragLayoutOrigin>();
  private diagnostic = false;
  private cameraId = 'default';
  private cameraAspectRatio = 16 / 9;
  private profiles = new Map<Handedness, CalibrationProfile>();
  private lastPoints: Partial<Record<Handedness, Point>> = {};
  private suppressUntilPalm = new Set<Handedness>();
  private swapHandler: ((swapped: boolean) => void) | null = null;
  private modeHandler: ((mode: 'jarvis' | 'megatron') => void) | null = null;
  private currentMode: 'jarvis' | 'megatron' = 'jarvis';

  private calibrationActive = false;
  private calibrationHand: Handedness | null = null;
  private calibrationIndex = 0;
  private calibrationSamples: CalibrationSample[] = [];
  private calibrationPreviousPinch = false;
  private readonly calibrationBuffer = new StableSampleBuffer();

  constructor(private readonly root: HTMLElement) {
    const swapped = localStorage.getItem('jericho.swap-hands') === 'true';
    this.root.innerHTML = `
      <div class="cam-wrap">
        <video class="cam" autoplay playsinline muted></video>
        <canvas class="cam-skel"></canvas>
        <div class="cam-label">DUAL HAND TRACE</div>
      </div>
      <div class="gesture-badge dual-badge">
        <span class="hand-state left-state">LEFT · NO HAND</span>
        <span class="hand-state right-state">RIGHT · NO HAND</span>
      </div>
      <div class="tracking-controls">
        <button class="tracking-button" data-pointer-id="calibrate-left" data-right-target>CAL LEFT</button>
        <button class="tracking-button" data-pointer-id="calibrate-right" data-right-target>CAL RIGHT</button>
        <button class="tracking-button" data-pointer-id="reset" data-right-target>RESET</button>
        <button class="tracking-button ${swapped ? 'ready' : ''}" data-pointer-id="swap" data-right-target>SWAP</button>
        <button class="tracking-button" data-pointer-id="diagnostic" data-right-target>DIAGNOSTIC</button>
        <button class="tracking-button" data-pointer-id="export" data-right-target>EXPORT 30S</button>
        <button class="tracking-button mode-toggle" data-pointer-id="mode-toggle" data-right-target>MEGATRON</button>
      </div>
      <pre class="diagnostic-panel"></pre>
      <nav class="nav">
        <div class="nav-head">COMMANDS</div>
        <ul class="nav-list"></ul>
        <div class="nav-hint">pink left · palm scroll · pinch select</div>
      </nav>
      <div class="status-line">JERICHO · STANDBY</div>
      <div class="mode-badge" id="mode-badge">JARVIS</div>
      <div class="wake-state standby" id="wake-state">● always listening · say "JARVIS"</div>
      <div class="stage"></div>
      <div class="transcript"></div>
      <div class="left-cursor" data-gesture="idle"></div>
      <div class="cursor" data-gesture="idle"></div>
      <div class="calibration-layer"><div class="calibration-copy"></div><div class="calibration-target"></div></div>
      <div class="mode-transition-overlay"></div>
      <div class="hint">left: palm scroll · pinch select | right: palm aim · pinch click/drag | ESC pauses</div>
    `;
    this.rightCursor = this.root.querySelector('.cursor') as HTMLElement;
    this.leftCursor = this.root.querySelector('.left-cursor') as HTMLElement;
    this.canvas = this.root.querySelector('.cam-skel') as HTMLCanvasElement;
    this.context = this.canvas.getContext('2d')!;

    this.root.querySelector('[data-pointer-id="calibrate-left"]')!.addEventListener('click', () => this.startCalibration('Left'));
    this.root.querySelector('[data-pointer-id="calibrate-right"]')!.addEventListener('click', () => this.startCalibration('Right'));
    this.root.querySelector('[data-pointer-id="reset"]')!.addEventListener('click', () => this.resetCalibration());
    this.root.querySelector('[data-pointer-id="swap"]')!.addEventListener('click', () => this.toggleSwap());
    this.root.querySelector('[data-pointer-id="diagnostic"]')!.addEventListener('click', () => this.toggleDiagnostic());
    this.root.querySelector('[data-pointer-id="export"]')!.addEventListener('click', () => this.exportDiagnostics());
    this.root.querySelector('[data-pointer-id="mode-toggle"]')!.addEventListener('click', () => this.modeHandler?.(this.currentMode === 'jarvis' ? 'megatron' : 'jarvis'));

    const stage = this.root.querySelector('.stage') as HTMLElement;
    SAMPLE_TASKS.forEach((task, index) => this.appendCard(stage, task.title, task.status, `card:${index}`));
    const nav = this.root.querySelector('.nav-list') as HTMLElement;
    NAV_COMMANDS.forEach(([key, label], index) => {
      const item = document.createElement('li');
      item.className = 'nav-item';
      item.dataset.navId = `nav:${index}`;
      item.innerHTML = `<span class="nav-key">${key}</span><span class="nav-cmd">${label}</span>`;
      nav.appendChild(item);
    });
  }

  get video(): HTMLVideoElement { return this.root.querySelector('.cam') as HTMLVideoElement; }

  onSwapHands(handler: (swapped: boolean) => void) { this.swapHandler = handler; }

  onModeToggle(handler: (mode: 'jarvis' | 'megatron') => void) { this.modeHandler = handler; }

  setMode(mode: 'jarvis' | 'megatron', name: string) {
    this.currentMode = mode;
    const badge = this.root.querySelector('#mode-badge') as HTMLElement;
    badge.textContent = name;
    badge.classList.remove('pending');
    badge.classList.toggle('combat', mode === 'megatron');
    this.root.classList.toggle('combat-mode', mode === 'megatron');
    const toggle = this.root.querySelector('[data-pointer-id="mode-toggle"]') as HTMLElement;
    toggle.textContent = mode === 'megatron' ? 'JARVIS' : 'MEGATRON';
    toggle.classList.toggle('ready', mode === 'megatron');
    // fire the transition flash
    const overlay = this.root.querySelector('.mode-transition-overlay') as HTMLElement;
    overlay.classList.remove('active');
    void overlay.offsetWidth; // force reflow to restart animation
    overlay.classList.add('active');
    setTimeout(() => overlay.classList.remove('active'), 800);
  }

  setModePending(_mode: 'jarvis' | 'megatron', name: string) {
    const badge = this.root.querySelector('#mode-badge') as HTMLElement;
    badge.textContent = `→ ${name}`;
    badge.classList.add('pending');
  }

  setCameraInfo(cameraId: string, width: number, height: number) {
    this.cameraId = cameraId || 'default';
    this.cameraAspectRatio = width > 0 && height > 0 ? width / height : 16 / 9;
    this.profiles.clear();
    for (const hand of ['Left', 'Right'] as const) {
      const profile = loadCalibration(localStorage, this.cameraId, this.cameraAspectRatio, hand);
      if (profile) this.profiles.set(hand, profile);
    }
    this.updateCalibrationButtons();
  }

  setStatus(text: string, online = false) {
    const status = this.root.querySelector('.status-line')!;
    status.textContent = text;
    status.classList.toggle('online', online);
  }

  setArmed(armed: boolean) {
    const element = this.root.querySelector('#wake-state') as HTMLElement;
    element.textContent = armed ? '● always listening · say "JARVIS"' : '○ standby · say "JARVIS" or click';
    element.classList.toggle('standby', !armed);
    element.classList.toggle('armed', armed);
  }

  onWakeClick(handler: () => void) {
    this.root.querySelector('#wake-state')!.addEventListener('click', (event) => {
      event.preventDefault();
      handler();
    });
  }

  setTranscript(text: string) { this.root.querySelector('.transcript')!.textContent = text; }

  addTask(name: string, title: string) {
    const card = this.appendCard(this.root.querySelector('.stage') as HTMLElement, title, 'working', `card:${this.cards.length}`);
    card.dataset.name = name;
  }

  completeTask(name: string, result: Record<string, unknown>) {
    const card = this.cards.find((element) => element.dataset.name === name);
    if (!card) return;
    card.classList.remove('working');
    card.classList.add('done');
    card.querySelector('.card-status')!.className = 'card-status done';
    card.querySelector('.card-meta')!.textContent = 'DONE';
    card.dataset.result = JSON.stringify(result);
  }

  showError(message: string) {
    const hint = this.root.querySelector('.hint') as HTMLElement;
    hint.textContent = `ERR: ${message}`;
    hint.style.color = 'var(--warn)';
  }

  onFrame(frame: GestureFrame) {
    this.drawTrace(frame);
    this.updateBadges(frame.left, frame.right);

    if (this.calibrationActive && this.calibrationHand) {
      this.applyActions(this.coordinator.cancelAll());
      const hand = this.calibrationHand === 'Left' ? frame.left : frame.right;
      if (hand?.fresh) this.handleCalibration(hand);
      this.hideCursors();
      this.updateDiagnosticPanel(frame, []);
      return;
    }

    const leftPoint = frame.left ? this.screenPoint(frame.left) : undefined;
    const rightPoint = frame.right ? this.screenPoint(frame.right) : undefined;
    this.updateCursor(this.leftCursor, frame.left, leftPoint, 'Left');
    this.updateCursor(this.rightCursor, frame.right, rightPoint, 'Right');

    const leftSuppressed = this.consumeSuppression(frame.left);
    const rightSuppressed = this.consumeSuppression(frame.right);
    const leftTarget = leftPoint ? this.leftTargetAt(leftPoint) : null;
    const rightTarget = rightPoint ? this.rightTargetAt(rightPoint) : null;
    const actions = this.coordinator.update(
      {
        hand: leftSuppressed ? undefined : frame.left,
        point: leftPoint ? { x: leftPoint.x, y: leftPoint.y / window.innerHeight } : undefined,
        targetId: leftTarget,
      },
      { hand: rightSuppressed ? undefined : frame.right, point: rightPoint, target: rightTarget },
      frame.timestamp,
    );
    this.applyActions(actions);
    const nav = this.root.querySelector('.nav-list') as HTMLElement;
    this.recorder.record({
      timestamp: frame.timestamp,
      frame,
      actions,
      scrollTop: nav.scrollTop,
      leftTarget,
      rightTarget: rightTarget?.id ?? null,
    });
    this.updateDiagnosticPanel(frame, actions);
  }

  private consumeSuppression(hand: TrackedHandFrame | undefined): boolean {
    if (!hand || !this.suppressUntilPalm.has(hand.handedness)) return false;
    if (hand.fresh && hand.state === 'palm') this.suppressUntilPalm.delete(hand.handedness);
    return true;
  }

  private updateCursor(cursor: HTMLElement, hand: TrackedHandFrame | undefined, point: Point | undefined, role: Handedness) {
    if (!hand) {
      cursor.classList.remove('active');
      delete this.lastPoints[role];
    } else if (hand.fresh && point && hand.state !== 'idle') {
      this.lastPoints[role] = point;
      cursor.style.transform = `translate(${point.x}px, ${point.y}px)`;
      cursor.dataset.gesture = hand.state;
      cursor.classList.add('active');
    } else if (hand.fresh && hand.state === 'idle') {
      cursor.classList.remove('active');
    }
    const active = this.leftCursor.classList.contains('active') || this.rightCursor.classList.contains('active');
    this.root.classList.toggle('cursor-hidden', active);
  }

  private hideCursors() {
    this.leftCursor.classList.remove('active');
    this.rightCursor.classList.remove('active');
    this.root.classList.remove('cursor-hidden');
  }

  private applyActions(actions: CoordinatorAction[]) {
    let scrolled = false;
    for (const event of actions) {
      if (event.channel === 'left') {
        const action = event.action;
        if (action.type === 'left-hover') {
          this.root.querySelectorAll<HTMLElement>('[data-nav-id]').forEach((element) =>
            element.classList.toggle('left-gesture-hover', element.dataset.navId === action.targetId),
          );
        } else if (action.type === 'left-scroll') {
          (this.root.querySelector('.nav-list') as HTMLElement).scrollTop += action.delta;
          scrolled = true;
        } else if (action.type === 'left-select') {
          this.activateNav(action.targetId);
        }
      } else {
        this.applyRightAction(event.action);
      }
    }
    this.root.querySelector('.nav')!.classList.toggle('scrolling', scrolled);
  }

  private applyRightAction(action: PointerAction) {
    if (action.type === 'hover') {
      this.root.querySelectorAll<HTMLElement>('[data-pointer-id], .card').forEach((element) =>
        element.classList.toggle('gesture-hover', this.rightId(element) === action.targetId),
      );
    } else if (action.type === 'click') {
      this.activateRightTarget(action.targetId);
    } else if (action.type === 'drag-start') {
      const element = this.elementForRightId(action.targetId);
      if (element) {
        const rect = element.getBoundingClientRect();
        this.dragOrigins.set(
          action.targetId,
          captureDragLayout(element.style.left, element.style.top, rect.left, rect.top),
        );
        this.selectionBeforeGrab = this.selected;
        this.selected = -1;
        this.grabPreviewId = action.targetId;
        this.renderSelection();
        element.classList.add('grab-preview');
        element.classList.add('dragging');
        this.rightCursor.classList.add('attached');
      }
    } else if (action.type === 'drag-move') {
      const element = this.elementForRightId(action.targetId);
      if (element) {
        element.style.left = `${action.left}px`;
        element.style.top = `${action.top}px`;
      }
    } else if (action.type === 'drag-end') {
      const element = this.elementForRightId(action.targetId);
      const origin = this.dragOrigins.get(action.targetId);
      if (element && origin) {
        if (action.cancelled) {
          const finished = finishDragLayout(origin, element.style.left, element.style.top, true);
          element.style.left = finished.left;
          element.style.top = finished.top;
          element.classList.remove('dragging', 'grab-preview');
          this.selected = this.selectionBeforeGrab ?? -1;
          this.renderSelection();
        } else {
          const visualBefore = element.getBoundingClientRect();
          element.classList.remove('dragging', 'grab-preview');
          this.selected = this.cards.indexOf(element);
          this.renderSelection();
          const visualAfter = element.getBoundingClientRect();
          const left = Number.parseFloat(element.style.left);
          const top = Number.parseFloat(element.style.top);
          if (Number.isFinite(left)) element.style.left = `${left + visualBefore.left - visualAfter.left}px`;
          if (Number.isFinite(top)) element.style.top = `${top + visualBefore.top - visualAfter.top}px`;
        }
      }
      this.dragOrigins.delete(action.targetId);
      this.selectionBeforeGrab = null;
      this.grabPreviewId = null;
      this.rightCursor.classList.remove('attached');
    }
  }

  private appendCard(stage: HTMLElement, title: string, status: Task['status'], pointerId: string): HTMLElement {
    const index = this.cards.length;
    const card = document.createElement('div');
    card.className = `card ${status}`;
    card.dataset.cardId = pointerId;
    card.style.left = `${250 + (index % 4) * 290}px`;
    card.style.top = `${window.innerHeight * 0.32 + Math.floor(index / 4) * 190 + (index % 2) * 40}px`;
    card.innerHTML = `<div class="card-status ${status}"></div><div class="card-title">${title}</div><div class="card-meta">${status.toUpperCase()}</div>`;
    stage.appendChild(card);
    this.cards.push(card);
    return card;
  }

  private screenPoint(hand: TrackedHandFrame): Point {
    const profile = this.profileFor(hand.handedness);
    if (profile) {
      const normalized = applyCalibration(profile.matrix, hand.smoothedAnchor);
      return { x: normalized.x * window.innerWidth, y: normalized.y * window.innerHeight };
    }
    const fallback = mapHandToScreen(hand.smoothedAnchor.x, hand.smoothedAnchor.y, window.innerWidth, window.innerHeight);
    return { x: fallback.px, y: fallback.py };
  }

  private profileFor(handedness: Handedness): CalibrationProfile | null {
    const cached = this.profiles.get(handedness);
    if (cached) return cached;
    const profile = loadCalibration(localStorage, this.cameraId, this.cameraAspectRatio, handedness);
    if (profile) this.profiles.set(handedness, profile);
    return profile;
  }

  private leftTargetAt(point: Point): string | null {
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-nav-id]')) {
      const rect = element.getBoundingClientRect();
      if (point.x >= rect.left - 12 && point.x <= rect.right + 12 && point.y >= rect.top - 12 && point.y <= rect.bottom + 12) {
        return element.dataset.navId ?? null;
      }
    }
    return null;
  }

  private rightTargetAt(point: Point): PointerTarget | null {
    const cardTargets = this.cards.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: this.rightId(element)!,
        draggable: true,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        boundaryDistance: 0,
      };
    });
    const cardHit = nearestCardHit(point, cardTargets);
    if (cardHit) return { ...cardHit.target, boundaryDistance: cardHit.boundaryDistance };

    const elements = [...this.root.querySelectorAll<HTMLElement>('[data-right-target]')].reverse();
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
        return {
          id: this.rightId(element)!,
          draggable: false,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          boundaryDistance: 0,
        };
      }
    }
    return null;
  }

  private rightId(element: HTMLElement): string | null { return element.dataset.cardId ?? element.dataset.pointerId ?? null; }

  private elementForRightId(id: string): HTMLElement | null {
    return [...this.cards, ...this.root.querySelectorAll<HTMLElement>('[data-pointer-id]')].find((element) => this.rightId(element) === id) ?? null;
  }

  private activateNav(id: string) {
    const item = [...this.root.querySelectorAll<HTMLElement>('[data-nav-id]')].find((element) => element.dataset.navId === id);
    this.root.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element === item));
    if (item) this.setTranscript(`→ ${item.querySelector('.nav-cmd')?.textContent ?? ''}`);
  }

  private activateRightTarget(id: string) {
    if (id.startsWith('card:')) {
      this.selected = this.cards.findIndex((card) => card.dataset.cardId === id);
      this.renderSelection();
    } else if (id === 'calibrate-left') this.startCalibration('Left');
    else if (id === 'calibrate-right') this.startCalibration('Right');
    else if (id === 'reset') this.resetCalibration();
    else if (id === 'swap') this.toggleSwap();
    else if (id === 'diagnostic') this.toggleDiagnostic();
    else if (id === 'export') this.exportDiagnostics();
    else if (id === 'mode-toggle') this.modeHandler?.(this.currentMode === 'jarvis' ? 'megatron' : 'jarvis');
  }

  private renderSelection() {
    this.cards.forEach((card, index) => card.classList.toggle('selected', index === this.selected));
  }

  private startCalibration(handedness: Handedness) {
    this.applyActions(this.coordinator.cancelAll());
    this.calibrationActive = true;
    this.calibrationHand = handedness;
    this.calibrationIndex = 0;
    this.calibrationSamples = [];
    this.calibrationPreviousPinch = false;
    this.calibrationBuffer.clear();
    this.root.classList.add('calibrating');
    this.renderCalibrationTarget(`Show your ${handedness.toUpperCase()} open palm at CENTER, hold, then pinch`);
  }

  private handleCalibration(hand: TrackedHandFrame) {
    if (hand.handedness !== this.calibrationHand) return;
    if (hand.state === 'palm') this.calibrationBuffer.push(hand.palmAnchor);
    const pinchStarted = hand.state === 'pinch' && !this.calibrationPreviousPinch;
    if (pinchStarted) {
      const sample = this.calibrationBuffer.median();
      if (!sample) this.renderCalibrationTarget('Hold the open palm steady longer, then pinch');
      else {
        const target = CALIBRATION_ORDER[this.calibrationIndex];
        this.calibrationSamples.push({ target, camera: sample });
        this.calibrationIndex++;
        this.calibrationBuffer.clear();
        if (this.calibrationIndex === CALIBRATION_ORDER.length) this.finishCalibration();
        else this.renderCalibrationTarget(`Move ${this.calibrationHand} palm to ${CALIBRATION_ORDER[this.calibrationIndex].toUpperCase()}, hold, then pinch`);
      }
    }
    this.calibrationPreviousPinch = hand.state === 'pinch';
  }

  private finishCalibration() {
    try {
      const profile = createCalibrationProfile(this.calibrationSamples, this.cameraId, this.cameraAspectRatio, this.calibrationHand!);
      saveCalibration(localStorage, profile);
      this.profiles.set(profile.handedness, profile);
      this.suppressUntilPalm.add(profile.handedness);
      this.calibrationActive = false;
      this.root.classList.remove('calibrating');
      this.setStatus(`JERICHO · ${profile.handedness.toUpperCase()} HAND CALIBRATED`, true);
      this.updateCalibrationButtons();
    } catch (error) {
      this.calibrationIndex = 0;
      this.calibrationSamples = [];
      this.calibrationBuffer.clear();
      this.renderCalibrationTarget(`${(error as Error).message}. Repeating from CENTER.`);
    }
  }

  private renderCalibrationTarget(message: string) {
    const targetName = CALIBRATION_ORDER[this.calibrationIndex];
    const point = TARGET_POINTS[targetName];
    const target = this.root.querySelector('.calibration-target') as HTMLElement;
    target.style.left = `${point.x * 100}%`;
    target.style.top = `${point.y * 100}%`;
    target.dataset.target = targetName;
    this.root.querySelector('.calibration-copy')!.textContent = message;
  }

  private resetCalibration() {
    resetCalibrations(localStorage, this.cameraId);
    this.profiles.clear();
    this.calibrationActive = false;
    this.root.classList.remove('calibrating');
    this.updateCalibrationButtons();
    this.setStatus('JERICHO · CALIBRATION RESET');
  }

  private updateCalibrationButtons() {
    for (const hand of ['Left', 'Right'] as const) {
      this.root.querySelector(`[data-pointer-id="calibrate-${hand.toLowerCase()}"]`)!.classList.toggle('ready', this.profiles.has(hand));
    }
  }

  private toggleSwap() {
    this.applyActions(this.coordinator.cancelAll());
    this.suppressUntilPalm.add('Left');
    this.suppressUntilPalm.add('Right');
    const swapped = localStorage.getItem('jericho.swap-hands') !== 'true';
    localStorage.setItem('jericho.swap-hands', String(swapped));
    this.root.querySelector('[data-pointer-id="swap"]')!.classList.toggle('ready', swapped);
    this.swapHandler?.(swapped);
  }

  private toggleDiagnostic() {
    this.diagnostic = !this.diagnostic;
    this.root.classList.toggle('diagnostic', this.diagnostic);
    this.root.querySelector('[data-pointer-id="diagnostic"]')!.classList.toggle('ready', this.diagnostic);
  }

  private exportDiagnostics() {
    const blob = new Blob([this.recorder.export()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jericho-gesture-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private updateBadges(left: TrackedHandFrame | undefined, right: TrackedHandFrame | undefined) {
    const update = (selector: string, hand: TrackedHandFrame | undefined) => {
      const element = this.root.querySelector(selector) as HTMLElement;
      if (!hand) {
        element.textContent = `${selector.includes('left') ? 'LEFT' : 'RIGHT'} · NO HAND`;
        element.classList.remove('hot');
        return;
      }
      const freshness = hand.fresh ? '' : ` · HOLD ${Math.round(hand.lossAgeMs)}ms`;
      element.textContent = `${hand.handedness.toUpperCase()} #${hand.trackId} · ${hand.state.toUpperCase()} · ${hand.pinchRatio.toFixed(2)}${freshness}`;
      element.classList.toggle('hot', hand.state === 'pinch');
    };
    update('.left-state', left);
    update('.right-state', right);
  }

  private drawTrace(frame: GestureFrame) {
    if (this.canvas.width !== 220) this.canvas.width = 220;
    if (this.canvas.height !== 124) this.canvas.height = 124;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const hand of frame.hands) {
      const color = hand.handedness === 'Left' ? '#ff69b4' : hand.state === 'pinch' ? '#ff8c3c' : '#409cff';
      this.context.globalAlpha = hand.fresh ? 1 : 0.4;
      if (this.diagnostic) {
        this.context.strokeStyle = color;
        this.context.fillStyle = color;
        this.context.lineWidth = 1.5;
        for (const [a, b] of CONNECTIONS) {
          const from = this.landmarkToCanvas(hand.landmarks[a]);
          const to = this.landmarkToCanvas(hand.landmarks[b]);
          this.context.beginPath(); this.context.moveTo(from.x, from.y); this.context.lineTo(to.x, to.y); this.context.stroke();
        }
        for (const landmark of hand.landmarks) {
          const point = this.landmarkToCanvas(landmark);
          this.context.beginPath(); this.context.arc(point.x, point.y, 2, 0, Math.PI * 2); this.context.fill();
        }
      }
      const thumb = this.landmarkToCanvas(hand.landmarks[4]);
      const index = this.landmarkToCanvas(hand.landmarks[8]);
      const anchor = this.mirroredPointToCanvas(hand.palmAnchor);
      this.context.strokeStyle = color; this.context.lineWidth = hand.state === 'pinch' ? 3 : 1.5;
      this.context.beginPath(); this.context.moveTo(thumb.x, thumb.y); this.context.lineTo(index.x, index.y); this.context.stroke();
      this.context.fillStyle = color; this.context.beginPath(); this.context.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2); this.context.fill();
    }
    this.context.globalAlpha = 1;
  }

  private landmarkToCanvas(landmark: Landmark): Point {
    const videoWidth = this.video.videoWidth || 1280;
    const videoHeight = this.video.videoHeight || 720;
    const canvasAspect = this.canvas.width / this.canvas.height;
    const videoAspect = videoWidth / videoHeight;
    let x = landmark.x;
    let y = landmark.y;
    if (videoAspect > canvasAspect) { const visible = canvasAspect / videoAspect; x = (x - (1 - visible) / 2) / visible; }
    else if (videoAspect < canvasAspect) { const visible = videoAspect / canvasAspect; y = (y - (1 - visible) / 2) / visible; }
    return { x: (1 - x) * this.canvas.width, y: y * this.canvas.height };
  }

  private mirroredPointToCanvas(point: Point): Point { return this.landmarkToCanvas({ x: 1 - point.x, y: point.y, z: 0 }); }

  private updateDiagnosticPanel(frame: GestureFrame, actions: CoordinatorAction[]) {
    const panel = this.root.querySelector('.diagnostic-panel') as HTMLElement;
    if (!this.diagnostic) { panel.textContent = ''; return; }
    const lines = [`fps ${frame.fps.toFixed(1)} · inference ${frame.inferenceMs.toFixed(1)}ms · replay ${this.recorder.size}`];
    for (const hand of frame.hands) {
      const point = this.lastPoints[hand.handedness];
      lines.push(
        `${hand.handedness} #${hand.trackId} raw=${hand.rawHandedness}(${hand.rawHandednessConfidence.toFixed(2)}) fresh=${hand.fresh} loss=${Math.round(hand.lossAgeMs)}ms`,
        `  ${hand.recognizedGesture}(${hand.gestureConfidence.toFixed(2)}) ${hand.state}/${hand.pinchPhase} ratio=${hand.pinchRatio.toFixed(3)} candidate=${Math.round(hand.pinchCandidateMs)}ms`,
        `  raw=${hand.palmAnchor.x.toFixed(3)},${hand.palmAnchor.y.toFixed(3)} smooth=${hand.smoothedAnchor.x.toFixed(3)},${hand.smoothedAnchor.y.toFixed(3)} screen=${point ? `${Math.round(point.x)},${Math.round(point.y)}` : '—'} assoc=${hand.associationDistance.toFixed(3)}`,
      );
    }
    lines.push(`actions ${actions.map((event) => `${event.channel}:${event.action.type}`).join(', ') || 'none'}`);
    panel.textContent = lines.join('\n');
  }
}
