import {
  LifecycleStatus,
  RiskLevel,
  type AgentCapability,
  type MissionTaskDefinition,
} from '@jericho/shared';

import { mergePermissionScopes, permissionScopeViolations } from './scope.js';

const RISK_ORDER: Record<RiskLevel, number> = {
  [RiskLevel.None]: 0,
  [RiskLevel.Low]: 1,
  [RiskLevel.Medium]: 2,
  [RiskLevel.High]: 3,
  [RiskLevel.Critical]: 4,
};

export class CapabilityRegistry {
  readonly #capabilities = new Map<string, AgentCapability>();

  constructor(capabilities: readonly AgentCapability[] = []) {
    for (const capability of capabilities) this.register(capability);
  }

  register(capability: AgentCapability): void {
    if (this.#capabilities.has(capability.id)) {
      throw new Error(`Capability ${capability.id} is already registered`);
    }
    this.#capabilities.set(capability.id, structuredClone(capability));
  }

  get(id: string): AgentCapability | undefined {
    const capability = this.#capabilities.get(id);
    return capability ? structuredClone(capability) : undefined;
  }

  list(): AgentCapability[] {
    return [...this.#capabilities.values()].map((item) => structuredClone(item));
  }

  assertTaskSupported(task: Readonly<MissionTaskDefinition>): AgentCapability[] {
    if (task.requiredActions.some((action) => action === 'spawn.unrestricted')) {
      throw new Error(`Task ${task.id} requests unrestricted assignment spawning`);
    }
    if (task.capabilityIds.length === 0) {
      throw new Error(`Task ${task.id} has no registered capability`);
    }
    const capabilities = task.capabilityIds.map((id) => {
      const capability = this.#capabilities.get(id);
      if (!capability) throw new Error(`Capability ${id} is not registered`);
      if (capability.status !== LifecycleStatus.Active) {
        throw new Error(`Capability ${id} is not active`);
      }
      if (capability.agentId !== task.selectedAgentId) {
        throw new Error(`Capability ${id} does not belong to ${task.selectedAgentId}`);
      }
      if (capability.lane !== task.lane) {
        throw new Error(`Capability ${id} does not belong to lane ${task.lane}`);
      }
      if (!capability.routes.includes(task.route)) {
        throw new Error(`Capability ${id} does not support route ${task.route}`);
      }
      if (RISK_ORDER[capability.maximumRisk] < RISK_ORDER[task.risk]) {
        throw new Error(`Capability ${id} cannot accept ${task.risk} risk`);
      }
      if (capability.mayCreateAssignments) {
        throw new Error(`Capability ${id} may create assignments without a bounded delegation plan`);
      }
      return capability;
    });

    const supported = new Set(capabilities.flatMap((item) => item.supportedActions));
    for (const action of task.requiredActions) {
      if (!supported.has(action)) {
        throw new Error(`Task ${task.id} action ${action} is not registered`);
      }
    }
    const supportedTools = new Set(capabilities.flatMap((item) => item.tools));
    for (const tool of task.requiredTools) {
      if (!supportedTools.has(tool)) {
        throw new Error(`Task ${task.id} tool ${tool} is not registered`);
      }
    }
    if (task.externalAction?.tool && !task.requiredTools.includes(task.externalAction.tool)) {
      throw new Error(`Task ${task.id} external tool ${task.externalAction.tool} is not required`);
    }
    if (task.externalAction && !task.requiredActions.includes(task.externalAction.action)) {
      throw new Error(`Task ${task.id} external action ${task.externalAction.action} is not registered`);
    }
    const modelCapabilities = capabilities.filter((item) =>
      item.modelPolicy.allowedModels.includes(task.model),
    );
    if (modelCapabilities.length === 0) {
      throw new Error(`Task ${task.id} model ${task.model} is not registered`);
    }
    if (
      modelCapabilities.every(
        (item) => task.maxTokens > item.modelPolicy.maxTokensPerAssignment,
      )
    ) {
      throw new Error(`Task ${task.id} max tokens exceed the registered model policy`);
    }
    const scopeViolations = permissionScopeViolations(
      task.writableScope,
      mergePermissionScopes(capabilities.map((item) => item.writableScope)),
    );
    if (scopeViolations.length > 0) {
      throw new Error(`Task ${task.id} writable scope is not registered: ${scopeViolations.join(', ')}`);
    }
    return capabilities.map((item) => structuredClone(item));
  }
}
