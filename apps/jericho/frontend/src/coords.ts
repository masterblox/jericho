/**
 * Canva-style hand → screen mapping.
 *
 * MediaPipe gives normalized coords in the FULL video frame (not the PIP crop).
 * Comfortable hand motion only spans ~60% of that frame, so we map an
 * "interaction box" onto the full viewport — same model as Leap / air-mouse.
 */

export interface InteractionBox {
  /** left edge of active zone in mirrored hand-space 0..1 */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Tuned for webcam-above-laptop: slightly top-biased so aiming at screen center feels natural. */
export const DEFAULT_BOX: InteractionBox = {
  x0: 0.16,
  x1: 0.84,
  y0: 0.12,
  y1: 0.82,
};

export interface ScreenPoint {
  px: number;
  py: number;
  /** normalized 0..1 after box map (pre-pixel) */
  nx: number;
  ny: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** smoothstep — soft edges so corners don't feel sticky */
function smooth01(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Map mirrored hand norm (0..1) → viewport pixels via interaction box.
 * `nx/ny` are already mirrored (screen-space): left hand left side of screen.
 */
export function mapHandToScreen(
  hx: number,
  hy: number,
  vw: number,
  vh: number,
  box: InteractionBox = DEFAULT_BOX,
): ScreenPoint {
  const bx = box.x1 - box.x0 || 1;
  const by = box.y1 - box.y0 || 1;
  // linear into box, then soft remap for gentler edges
  const lx = (hx - box.x0) / bx;
  const ly = (hy - box.y0) / by;
  const nx = smooth01(lx);
  const ny = smooth01(ly);
  return { nx, ny, px: nx * vw, py: ny * vh };
}

/** Linear interpolate two normalized points (for gesture-transition anti-jump). */
export function lerpNorm(
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = clamp01(t);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export function smoothstep(t: number): number {
  return smooth01(t);
}

/**
 * Velocity-adaptive EMA alpha.
 * Fast flicks → snappier; idle → stable.
 */
export function adaptiveAlpha(
  dx: number,
  dy: number,
  base: number,
  minA: number,
  maxA: number,
): number {
  const speed = Math.hypot(dx, dy); // in norm units per frame
  const a = base + speed * 6;
  return a < minA ? minA : a > maxA ? maxA : a;
}

/**
 * Lag-free outlier clamp — replaces the old median filter.
 *
 * The median filter caused ~130ms lag during gesture transitions (tip→knuckle),
 * which the delta-lock misread as hand motion → cursor drift. This clamp kills
 * single-frame spikes (MediaPipe hallucinations) with ZERO added latency.
 */
export class CoordClamp {
  private lastX = 0.5;
  private lastY = 0.5;
  private hasLast = false;

  constructor(private maxJump = 0.3) {}

  push(x: number, y: number): { x: number; y: number } {
    if (this.hasLast) {
      const ddx = x - this.lastX;
      const ddy = y - this.lastY;
      const d = Math.hypot(ddx, ddy);
      if (d > this.maxJump) {
        const s = this.maxJump / d;
        x = this.lastX + ddx * s;
        y = this.lastY + ddy * s;
      }
    }
    this.lastX = x;
    this.lastY = y;
    this.hasLast = true;
    return { x, y };
  }

  reset() {
    this.hasLast = false;
  }
}
