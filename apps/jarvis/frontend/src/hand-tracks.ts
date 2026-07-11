import {
  AdaptivePointFilter,
  OWNER_LOSS_MS,
  PinchLatch,
  type GestureState,
  type Handedness,
  type Landmark,
  type PinchPhase,
  type Point,
} from './tracking';

export type HandTrackId = number;

export interface RawHandObservation {
  rawHandedness: Handedness;
  handednessConfidence: number;
  recognizedGesture: string;
  gestureConfidence: number;
  confidence: number;
  landmarks: Landmark[];
  palmAnchor: Point;
  pinchPoint: Point;
  pinchRatio: number;
  atFrameEdge: boolean;
  openPalm: boolean;
}

export interface TrackedHandFrame {
  trackId: HandTrackId;
  handedness: Handedness;
  handednessConfidence: number;
  rawHandedness: Handedness;
  rawHandednessConfidence: number;
  state: GestureState;
  recognizedGesture: string;
  gestureConfidence: number;
  confidence: number;
  landmarks: Landmark[];
  palmAnchor: Point;
  smoothedAnchor: Point;
  pinchPoint: Point;
  smoothedPinch: Point;
  velocity: Point;
  pinchRatio: number;
  pinchPhase: PinchPhase;
  pinchCandidateMs: number;
  fresh: boolean;
  lastSeenAt: number;
  lossAgeMs: number;
  associationDistance: number;
}

interface TrackRuntime {
  id: HandTrackId;
  handedness: Handedness;
  filter: AdaptivePointFilter;
  pinchFilter: AdaptivePointFilter;
  pinch: PinchLatch;
  lastSeenAt: number;
  lastRawAnchor: Point;
  velocity: Point;
  frame: TrackedHandFrame;
}

const ASSOCIATION_GATE = 0.45;
const HANDEDNESS_MISMATCH_PENALTY = 0.08;

function opposite(handedness: Handedness): Handedness {
  return handedness === 'Left' ? 'Right' : 'Left';
}

function predictedAnchor(track: TrackRuntime, now: number): Point {
  const dt = Math.min(0.12, Math.max(0, (now - track.lastSeenAt) / 1000));
  return {
    x: track.lastRawAnchor.x + track.velocity.x * dt,
    y: track.lastRawAnchor.y + track.velocity.y * dt,
  };
}

function associationCost(track: TrackRuntime, observation: RawHandObservation, now: number): number {
  const predicted = predictedAnchor(track, now);
  const distance = Math.hypot(predicted.x - observation.palmAnchor.x, predicted.y - observation.palmAnchor.y);
  const handednessPenalty = track.handedness === observation.rawHandedness ? 0 : HANDEDNESS_MISMATCH_PENALTY;
  return distance + handednessPenalty * observation.handednessConfidence;
}

export class HandTrackManager {
  private tracks: TrackRuntime[] = [];
  private nextTrackId = 1;

  update(observations: RawHandObservation[], now: number, swapRoles = false): TrackedHandFrame[] {
    this.tracks = this.tracks.filter((track) => now - track.lastSeenAt <= OWNER_LOSS_MS);
    const matches = this.match(observations, now);
    const matchedObservations = new Set<number>();
    const matchedTracks = new Set<HandTrackId>();

    for (const [trackIndex, observationIndex] of matches) {
      const track = this.tracks[trackIndex];
      const observation = observations[observationIndex];
      this.updateTrack(track, observation, now, associationCost(track, observation, now));
      matchedTracks.add(track.id);
      matchedObservations.add(observationIndex);
    }

    const unmatched = observations
      .map((observation, index) => ({ observation, index }))
      .filter(({ index }) => !matchedObservations.has(index))
      .sort((a, b) => b.observation.handednessConfidence - a.observation.handednessConfidence);
    for (const { observation } of unmatched) {
      if (this.tracks.length >= 2) break;
      const occupied = new Set(this.tracks.map((track) => track.handedness));
      const handedness = occupied.has(observation.rawHandedness)
        ? opposite(observation.rawHandedness)
        : observation.rawHandedness;
      const track = this.createTrack(observation, handedness, now);
      this.tracks.push(track);
      matchedTracks.add(track.id);
    }

    return this.tracks.map((track) => {
      const fresh = matchedTracks.has(track.id);
      const role = swapRoles ? opposite(track.handedness) : track.handedness;
      return {
        ...track.frame,
        handedness: role,
        fresh,
        lossAgeMs: fresh ? 0 : now - track.lastSeenAt,
        pinchCandidateMs: track.pinch.candidateMs(now),
      };
    });
  }

  reset() {
    this.tracks = [];
    this.nextTrackId = 1;
  }

  private match(observations: RawHandObservation[], now: number): Array<[number, number]> {
    if (!this.tracks.length || !observations.length) return [];
    if (this.tracks.length === 1) {
      let bestIndex = 0;
      let bestCost = Number.POSITIVE_INFINITY;
      observations.forEach((observation, index) => {
        const cost = associationCost(this.tracks[0], observation, now);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = index;
        }
      });
      return bestCost <= ASSOCIATION_GATE ? [[0, bestIndex]] : [];
    }
    if (observations.length === 1) {
      const costs = this.tracks.map((track) => associationCost(track, observations[0], now));
      const index = costs[0] <= costs[1] ? 0 : 1;
      return costs[index] <= ASSOCIATION_GATE ? [[index, 0]] : [];
    }

    const direct = associationCost(this.tracks[0], observations[0], now) + associationCost(this.tracks[1], observations[1], now);
    const crossed = associationCost(this.tracks[0], observations[1], now) + associationCost(this.tracks[1], observations[0], now);
    const pairs: Array<[number, number]> = direct <= crossed ? [[0, 0], [1, 1]] : [[0, 1], [1, 0]];
    return pairs.filter(([trackIndex, observationIndex]) =>
      associationCost(this.tracks[trackIndex], observations[observationIndex], now) <= ASSOCIATION_GATE,
    );
  }

  private createTrack(observation: RawHandObservation, handedness: Handedness, now: number): TrackRuntime {
    const filter = new AdaptivePointFilter();
    const pinchFilter = new AdaptivePointFilter();
    const pinch = new PinchLatch();
    const smoothedAnchor = filter.push(observation.palmAnchor);
    const smoothedPinch = pinchFilter.push(observation.pinchPoint);
    const closedFist = observation.recognizedGesture === 'Closed_Fist';
    const pinched = closedFist
      ? false
      : pinch.update(observation.pinchRatio, observation.atFrameEdge, now);
    const frame: TrackedHandFrame = {
      trackId: this.nextTrackId++,
      handedness,
      handednessConfidence: observation.handednessConfidence,
      rawHandedness: observation.rawHandedness,
      rawHandednessConfidence: observation.handednessConfidence,
      state: pinched ? 'pinch' : !closedFist && observation.openPalm ? 'palm' : 'idle',
      recognizedGesture: observation.recognizedGesture,
      gestureConfidence: observation.gestureConfidence,
      confidence: observation.confidence,
      landmarks: observation.landmarks,
      palmAnchor: observation.palmAnchor,
      smoothedAnchor,
      pinchPoint: observation.pinchPoint,
      smoothedPinch,
      velocity: { x: 0, y: 0 },
      pinchRatio: observation.pinchRatio,
      pinchPhase: pinch.phase,
      pinchCandidateMs: pinch.candidateMs(now),
      fresh: true,
      lastSeenAt: now,
      lossAgeMs: 0,
      associationDistance: 0,
    };
    return {
      id: frame.trackId,
      handedness,
      filter,
      pinchFilter,
      pinch,
      lastSeenAt: now,
      lastRawAnchor: observation.palmAnchor,
      velocity: { x: 0, y: 0 },
      frame,
    };
  }

  private updateTrack(track: TrackRuntime, observation: RawHandObservation, now: number, distance: number) {
    const dt = Math.max(0.001, (now - track.lastSeenAt) / 1000);
    const instantaneous = {
      x: (observation.palmAnchor.x - track.lastRawAnchor.x) / dt,
      y: (observation.palmAnchor.y - track.lastRawAnchor.y) / dt,
    };
    track.velocity = {
      x: track.velocity.x * 0.65 + instantaneous.x * 0.35,
      y: track.velocity.y * 0.65 + instantaneous.y * 0.35,
    };
    const closedFist = observation.recognizedGesture === 'Closed_Fist';
    if (closedFist) track.pinch.reset();
    const pinched = closedFist
      ? false
      : track.pinch.update(observation.pinchRatio, observation.atFrameEdge, now);
    track.lastSeenAt = now;
    track.lastRawAnchor = observation.palmAnchor;
    track.frame = {
      ...track.frame,
      handedness: track.handedness,
      handednessConfidence: Math.max(track.frame.handednessConfidence * 0.9, observation.handednessConfidence),
      rawHandedness: observation.rawHandedness,
      rawHandednessConfidence: observation.handednessConfidence,
      state: pinched ? 'pinch' : !closedFist && observation.openPalm ? 'palm' : 'idle',
      recognizedGesture: observation.recognizedGesture,
      gestureConfidence: observation.gestureConfidence,
      confidence: observation.confidence,
      landmarks: observation.landmarks,
      palmAnchor: observation.palmAnchor,
      smoothedAnchor: track.filter.push(observation.palmAnchor),
      pinchPoint: observation.pinchPoint,
      smoothedPinch: track.pinchFilter.push(observation.pinchPoint),
      velocity: track.velocity,
      pinchRatio: observation.pinchRatio,
      pinchPhase: track.pinch.phase,
      pinchCandidateMs: track.pinch.candidateMs(now),
      fresh: true,
      lastSeenAt: now,
      lossAgeMs: 0,
      associationDistance: distance,
    };
  }
}
