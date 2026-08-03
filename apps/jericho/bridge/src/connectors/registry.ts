import type { CaptureConnector } from './contracts.js';

export class CaptureConnectorRegistry {
  readonly #connectors = new Map<string, CaptureConnector>();

  constructor(connectors: readonly CaptureConnector[] = []) {
    connectors.forEach((connector) => this.register(connector));
  }

  register(connector: CaptureConnector): void {
    const { descriptor } = connector;
    if (!descriptor.id || !Number.isInteger(descriptor.adapterVersion) || descriptor.adapterVersion < 1) {
      throw new Error('Connector descriptor is invalid');
    }
    if (!Number.isInteger(descriptor.cursorSchemaVersion) || descriptor.cursorSchemaVersion < 1) {
      throw new Error(`Connector ${descriptor.id} cursor schema version is invalid`);
    }
    if (this.#connectors.has(descriptor.id)) {
      throw new Error(`Connector ${descriptor.id} is already registered`);
    }
    this.#connectors.set(descriptor.id, connector);
  }

  get(id: string): CaptureConnector | undefined {
    return this.#connectors.get(id);
  }

  require(id: string): CaptureConnector {
    const connector = this.get(id);
    if (!connector) throw new Error(`Connector ${id} is not registered`);
    return connector;
  }

  list(): CaptureConnector[] {
    return [...this.#connectors.values()].sort((first, second) =>
      first.descriptor.id.localeCompare(second.descriptor.id),
    );
  }
}
