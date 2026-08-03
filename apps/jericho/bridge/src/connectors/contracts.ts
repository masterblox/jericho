import {
  ConnectorCapability,
  type CaptureFailure,
  type ConnectorHealthStatus,
  type JsonObject,
  type NormalizedCapture,
  type VersionedCursor,
} from '@jericho/shared';

export interface ConnectorDescriptor {
  id: string;
  adapterVersion: number;
  cursorSchemaVersion: number;
  partitions: string[];
  maxBatchSize: number;
}

export interface ConnectorProbe {
  status: ConnectorHealthStatus;
  details: JsonObject;
}

export interface ConnectorCaptureRequest {
  partition: string;
  cursor?: VersionedCursor;
  limit: number;
  observedAt: string;
  signal: AbortSignal;
}

export interface ConnectorCapturePage {
  captures: NormalizedCapture[];
  failures: CaptureFailure[];
  progress: {
    epoch: number;
    sequence: number;
    pageToken?: string;
    watermark?: string;
    overlapFrom?: string;
  };
  hasMore: boolean;
}

export interface CaptureConnector {
  descriptor: ConnectorDescriptor;
  probe(signal: AbortSignal): Promise<ConnectorProbe>;
  capture(request: ConnectorCaptureRequest): Promise<ConnectorCapturePage>;
}

export class ConnectorUnavailableError extends Error {
  readonly capability = ConnectorCapability.Capture;

  constructor(message: string) {
    super(message);
    this.name = 'ConnectorUnavailableError';
  }
}

export class ConnectorUnauthorizedError extends Error {
  readonly capability = ConnectorCapability.Capture;

  constructor(message: string) {
    super(message);
    this.name = 'ConnectorUnauthorizedError';
  }
}
