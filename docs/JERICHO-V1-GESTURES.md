# Jericho v1.0.4 Gesture System

The v1 interaction surface deliberately recognizes only a stable palm pointer
and a thumb/index pinch action.

## Data flow

1. MediaPipe emits 21 landmarks and raw handedness for up to two hands. Palm
   proximity and velocity maintain persistent track IDs; handedness assigns the
   stable physical role and can be corrected with the persisted swap control.
2. The palm anchor is the mean of landmarks `0, 5, 9, 13, 17`, mirrored into
   screen direction and passed through a velocity-adaptive filter.
3. Pinch distance `|thumb tip - index tip|` is normalized by palm width
   `|index MCP - pinky MCP|`. It engages at `0.35` for 80 ms and releases at
   `0.50` for 60 ms. Frame edges block only new engagement; a generic
   `Closed_Fist` classification cannot veto valid pinch geometry.
4. Left and right tracks feed independent controllers. Left palm displacement
   scrolls from a neutral anchor and left pinch selects. Right palm aims and
   right pinch clicks or drags.
5. A per-camera/per-hand homography maps the calibrated palm anchor to normalized
   viewport coordinates. Without a profile, the previous interaction box is a
   non-persistent fallback so the calibration controls remain reachable.
6. Tracks remain frozen for up to 350 ms of loss without stale actions. Longer
   loss cancels only that role.
7. Fresh right pinch card acquisition uses nearest-card footprint geometry: the
   cursor center may be inside or within 18 px of a card boundary. Controls keep
   exact hit testing. A pinch that starts unbound cannot acquire a card mid-hold.
8. On acquisition, the grab offset is clamped to a 14 px inset and the card—not
   the cursor—moves by that minimum correction. Attachment emits `drag-start` and
   the first `drag-move` on the same frame. Grab preview clears the prior
   selection outline and outlines the grabbed card in orange. Quick release
   restores and clicks; a 120 ms hold or 6 px move commits the drop; cancellation
   restores position and the previous selection.

## Calibration

Calibration captures a median of at least eight stable open-palm frames at the
center and four corners. The corners compute the projective transform and center
is a held-out validation point. Profiles with center residual above 5% are
rejected. Profiles are invalidated if camera identity changes or camera aspect
ratio moves by more than 2%.

## Live acceptance

After calibrating each hand, exercise a nine-point screen grid at 1920×1080:

- median target error: at most 24 px;
- 95th-percentile target error: at most 48 px;
- palm-to-pinch transition: at most 8 px;
- no track/role swap while both hands remain visible or cross;
- left scrolling and right dragging can occur in the same frames;
- no click or drag from a fist, unknown pose, or stale frame;
- orange cursor remains above and attached to the grabbed point from the first
  pinched frame, with deterministic offset error at most 1 px;
- a fresh pinch near a card edge acquires that card and keeps the full orange
  circle at least 14 px inside; the orange outline always matches the grabbed card.

The diagnostic toggle exposes both track IDs, raw/stabilized handedness,
raw/smoothed anchors, screen coordinates, pinch phases, association distance,
camera metadata, FPS, and both skeletons. The local 30-second exporter provides
the same frames and emitted actions for deterministic replay without uploading.
