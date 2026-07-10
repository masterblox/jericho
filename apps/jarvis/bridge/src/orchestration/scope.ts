import {
  type ExternalActionSpec,
  type MissionPermissions,
  type MutationClass,
  type RepositoryGrant,
} from '@jericho/shared';

const STRING_SCOPE_FIELDS = [
  'allowedTools',
  'allowedSystems',
  'allowedChannels',
  'allowedRecipients',
  'allowedCredentialRefs',
  'allowedDataScopes',
] as const satisfies readonly (keyof MissionPermissions)[];

export function permissionScopeViolations(
  requested: Readonly<MissionPermissions>,
  allowed: Readonly<MissionPermissions>,
): string[] {
  const violations: string[] = [];
  for (const field of STRING_SCOPE_FIELDS) {
    const allowedValues = new Set(allowed[field]);
    for (const value of requested[field]) {
      if (!allowedValues.has(value)) violations.push(`${field}:${value}`);
    }
  }

  const allowedMutations = new Set(allowed.allowedMutationClasses);
  for (const mutation of requested.allowedMutationClasses) {
    if (!allowedMutations.has(mutation)) {
      violations.push(`allowedMutationClasses:${mutation}`);
    }
  }

  const grants = mergeRepositoryGrants(allowed.allowedRepositories);
  for (const requestedGrant of requested.allowedRepositories) {
    const allowedGrant = grants.get(requestedGrant.repository);
    if (!allowedGrant) {
      violations.push(`allowedRepositories:${requestedGrant.repository}`);
      continue;
    }
    for (const mutation of requestedGrant.mutationClasses) {
      if (!allowedGrant.mutationClasses.has(mutation)) {
        violations.push(`repositoryMutation:${requestedGrant.repository}:${mutation}`);
      }
    }
    for (const path of requestedGrant.writablePaths) {
      if (![...allowedGrant.writablePaths].some((root) => pathIsWithin(path, root))) {
        violations.push(`repositoryPath:${requestedGrant.repository}:${path}`);
      }
    }
  }
  return [...new Set(violations)];
}

export function permissionScopeIsSubset(
  requested: Readonly<MissionPermissions>,
  allowed: Readonly<MissionPermissions>,
): boolean {
  return permissionScopeViolations(requested, allowed).length === 0;
}

export function mergePermissionScopes(
  scopes: readonly Readonly<MissionPermissions>[],
): MissionPermissions {
  const merged = emptyPermissions();
  for (const field of STRING_SCOPE_FIELDS) {
    merged[field] = unique(scopes.flatMap((scope) => scope[field])) as never;
  }
  merged.allowedMutationClasses = unique(
    scopes.flatMap((scope) => scope.allowedMutationClasses),
  ) as MutationClass[];

  const grants = mergeRepositoryGrants(scopes.flatMap((scope) => scope.allowedRepositories));
  merged.allowedRepositories = [...grants.entries()].map(([repository, grant]) => ({
    repository,
    writablePaths: [...grant.writablePaths],
    mutationClasses: [...grant.mutationClasses],
  }));
  return merged;
}

export function externalActionScopeViolations(
  action: Readonly<ExternalActionSpec>,
  scope: Readonly<MissionPermissions>,
): string[] {
  const violations: string[] = [];
  for (const [field, value, allowed] of [
    ['tool', action.tool, scope.allowedTools],
    ['connector', action.connectorId, scope.allowedSystems],
    ['system', action.system, scope.allowedSystems],
    ['channel', action.channel, scope.allowedChannels],
    ['recipient', action.recipient, scope.allowedRecipients],
    ['credentialRef', action.credentialRef, scope.allowedCredentialRefs],
    ['dataScope', action.dataScope, scope.allowedDataScopes],
  ] as const) {
    if (value && !allowed.includes(value)) violations.push(`${field}:${value}`);
  }
  if (!scope.allowedMutationClasses.includes(action.mutationClass)) {
    violations.push(`mutationClass:${action.mutationClass}`);
  }

  if (action.repository) {
    const requested: MissionPermissions = {
      ...emptyPermissions(),
      allowedRepositories: [{
        repository: action.repository,
        writablePaths: action.repositoryPath ? [action.repositoryPath] : [],
        mutationClasses: [action.mutationClass],
      }],
    };
    violations.push(...permissionScopeViolations(requested, scope));
  }
  return [...new Set(violations)];
}

function emptyPermissions(): MissionPermissions {
  return {
    allowedTools: [],
    allowedSystems: [],
    allowedRepositories: [],
    allowedChannels: [],
    allowedRecipients: [],
    allowedCredentialRefs: [],
    allowedDataScopes: [],
    allowedMutationClasses: [],
  };
}

function mergeRepositoryGrants(grants: readonly Readonly<RepositoryGrant>[]) {
  const merged = new Map<string, {
    writablePaths: Set<string>;
    mutationClasses: Set<MutationClass>;
  }>();
  for (const grant of grants) {
    const current = merged.get(grant.repository) ?? {
      writablePaths: new Set<string>(),
      mutationClasses: new Set<MutationClass>(),
    };
    grant.writablePaths.forEach((path) => current.writablePaths.add(path));
    grant.mutationClasses.forEach((mutation) => current.mutationClasses.add(mutation));
    merged.set(grant.repository, current);
  }
  return merged;
}

function pathIsWithin(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeRepositoryPath(candidate);
  const normalizedRoot = normalizeRepositoryPath(root);
  if (!normalizedCandidate || !normalizedRoot) return false;
  if (normalizedRoot === '.') return true;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function normalizeRepositoryPath(value: string): string | undefined {
  if (value.startsWith('/') || value.includes('\\')) return undefined;
  const parts = value.replace(/^\.\//, '').replace(/\/$/, '').split('/');
  if (parts.some((part) => part === '' || part === '..')) return undefined;
  return parts.join('/');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
