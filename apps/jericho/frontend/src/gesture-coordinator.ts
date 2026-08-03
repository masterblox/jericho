import { LeftNavigationController, type LeftNavigationAction } from './left-navigation';
import { PointerController, type PointerAction, type PointerTarget } from './pointer-controller';
import type { TrackedHandFrame } from './hand-tracks';
import type { Point } from './tracking';

export type CoordinatorAction =
  | { channel: 'left'; action: LeftNavigationAction }
  | { channel: 'right'; action: PointerAction };

export interface RoleInput {
  hand?: TrackedHandFrame;
  point?: Point;
  targetId?: string | null;
  target?: PointerTarget | null;
}

export class GestureCoordinator {
  private readonly left = new LeftNavigationController();
  private readonly right = new PointerController();

  update(leftInput: RoleInput, rightInput: RoleInput, now: number): CoordinatorAction[] {
    const actions: CoordinatorAction[] = [];
    if (!leftInput.hand) {
      actions.push(...this.left.cancel().map((action) => ({ channel: 'left' as const, action })));
    } else if (leftInput.hand.fresh && leftInput.point) {
      actions.push(
        ...this.left
          .update(leftInput.point, leftInput.hand.state, now, leftInput.targetId ?? null)
          .map((action) => ({ channel: 'left' as const, action })),
      );
    } else {
      this.left.pause();
    }

    if (!rightInput.hand) {
      actions.push(...this.right.cancel().map((action) => ({ channel: 'right' as const, action })));
    } else if (rightInput.hand.fresh && rightInput.point) {
      actions.push(
        ...this.right
          .update(rightInput.point, rightInput.hand.state, now, rightInput.target ?? null)
          .map((action) => ({ channel: 'right' as const, action })),
      );
    }
    return actions;
  }

  cancelAll(): CoordinatorAction[] {
    return [
      ...this.left.cancel().map((action) => ({ channel: 'left' as const, action })),
      ...this.right.cancel().map((action) => ({ channel: 'right' as const, action })),
    ];
  }
}
