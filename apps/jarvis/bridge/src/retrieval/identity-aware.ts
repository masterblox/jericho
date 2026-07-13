import { createHash } from 'node:crypto';

import type {
  AnswerConfidence,
  GroundedResultAction,
  GroundedResultClaim,
  GroundedResultConflict,
  GroundedResultEvent,
  GroundedResultPhase,
  GroundedResultProvenance,
  IdentityAwareRetrievalResult,
  IdentityEvidenceGroup,
  IdentityEvidenceProvenance,
  KnowledgeRoute,
  MemoryRootAuthority,
} from '@jericho/shared';

export interface VaultEvidenceHit {
  path: string;
  title: string;
  excerpt: string;
  score: number;
  sourceId?: string;
  rootId?: string;
  authority?: MemoryRootAuthority;
  content?: string;
}

/** Configuration for identity-aware evidence grouping. */
export interface GroupIdentityConfig {
  canonicalFullName: string;
  firstNamePattern: RegExp;
  canonicalPattern: RegExp;
  /** Only explicit wife/spouse/married evidence or confirmed Core relations may establish marriage. */
  relationshipPatterns?: RegExp[];
  employmentPattern?: RegExp;
  employmentLabel?: string;
  relationshipLabel?: string;
}

/** Optional Isabella canary config — never used as a silent default fallback. */
export const ISABELLA_IDENTITY: GroupIdentityConfig = {
  canonicalFullName: 'Isabella Handel',
  firstNamePattern: /(?:^|[^\p{L}])isabella(?:[^\p{L}]|$)/iu,
  canonicalPattern: /isabella\s+handel/iu,
  relationshipPatterns: [
    /(?:wife|spouse|married).{0,40}carlos/iu,
    /carlos.{0,40}(?:wife|spouse|married)/iu,
  ],
  employmentPattern: /master\s*blox/iu,
  employmentLabel: 'MasterBlox',
  relationshipLabel: 'wife / spouse of Carlos Prada',
};

export interface CoreIdentityOverride {
  /** Claim patterns that must never be asserted from file evidence. */
  exclusions?: readonly { claimPattern: string }[];
  /** Confirmed relations that may establish relationship labels. */
  confirmedRelations?: readonly { type: string; label: string }[];
}

export interface IdentityCacheKey {
  question: string;
  indexRevision: string;
}

/**
 * Derive a conservative full-name candidate from vault hit titles/paths.
 * Never binds first-name-only evidence automatically.
 */
export function deduceCanonicalFullName(hit: VaultEvidenceHit): string | undefined {
  // Prefer the note title; paths often contain vault folder prefixes.
  for (const text of [hit.title, hit.path.replace(/\.md$/iu, '').split('/').pop() ?? '']) {
    const match = /([\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*)+)/u.exec(text);
    if (!match) continue;
    const candidate = match[1]!.trim();
    if (candidate.split(/\s+/u).length < 2) continue;
    return candidate;
  }
  return undefined;
}

export function normalizeQuestion(question: string): string {
  return question.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

export class IdentityResolutionCache {
  readonly #entries = new Map<string, CachedGroundedRetrieval>();

  get(key: IdentityCacheKey): CachedGroundedRetrieval | undefined {
    return this.#entries.get(cacheKey(key));
  }

  set(key: IdentityCacheKey, value: CachedGroundedRetrieval): void {
    this.#entries.set(cacheKey(key), value);
  }

  invalidate(): void {
    this.#entries.clear();
  }

  invalidateRevision(_indexRevision: string): void {
    this.#entries.clear();
  }
}

/** Complete retrieval material so cache hits retain provenance/actions/conflicts. */
export interface CachedGroundedRetrieval {
  evidence: IdentityAwareRetrievalResult;
  hits: VaultEvidenceHit[];
  event?: GroundedResultEvent;
}

function cacheKey(key: IdentityCacheKey): string {
  return `${normalizeQuestion(key.question)}::${key.indexRevision}`;
}

export function groupIdentityEvidence(
  query: string,
  hits: readonly VaultEvidenceHit[],
  retrievalCount = 1,
  config?: GroupIdentityConfig,
  overrides?: CoreIdentityOverride,
): IdentityAwareRetrievalResult {
  const effective = config ?? deriveConfigFromEvidence(query, hits);
  if (!effective) {
    return { query, groups: [], excluded: [], retrievalCount };
  }
  const groups = new Map<string, IdentityEvidenceGroup>();
  const excluded: IdentityEvidenceGroup[] = [];

  for (const hit of hits) {
    const text = `${hit.title} ${hit.path} ${hit.excerpt}`;
    if (
      !effective.firstNamePattern.test(text) &&
      !effective.firstNamePattern.test(hit.title) &&
      !effective.firstNamePattern.test(hit.path)
    ) {
      continue;
    }
    const provenance: IdentityEvidenceProvenance = {
      ...(hit.sourceId ? { sourceId: hit.sourceId } : {}),
      ...(hit.rootId ? { rootId: hit.rootId } : {}),
      ...(hit.authority ? { authority: hit.authority } : {}),
      relativePath: hit.path,
      title: hit.title,
      excerpt: hit.excerpt.slice(0, 480),
      score: hit.score,
    };
    const isCanonical =
      effective.canonicalPattern.test(text) ||
      effective.canonicalPattern.test(hit.title) ||
      effective.canonicalPattern.test(hit.path);

    if (isCanonical) {
      const existing = groups.get(effective.canonicalFullName) ?? {
        fullName: effective.canonicalFullName,
        canonical: true,
        ambiguous: false,
        provenance: [],
      };
      existing.provenance.push(provenance);
      const relationship = inferRelationship(text, effective, overrides);
      if (relationship) existing.relationshipToCarlos = relationship;
      const employment = inferEmployment(text, effective);
      if (employment.length) {
        existing.employment = [...new Set([...(existing.employment ?? []), ...employment])];
      }
      groups.set(effective.canonicalFullName, existing);
      continue;
    }

    // First-name-only evidence never auto-attaches.
    const label = normalizeFirstNameLabel(hit.title, effective)
      || `${effective.canonicalFullName.split(/\s+/u)[0]} (ambiguous)`;
    excluded.push({
      fullName: label,
      canonical: false,
      ambiguous: true,
      provenance: [provenance],
    });
  }

  const resolved = groups.get(effective.canonicalFullName);
  if (resolved && overrides?.exclusions?.length) {
    for (const exclusion of overrides.exclusions) {
      const pattern = exclusion.claimPattern.toLocaleLowerCase();
      if (resolved.relationshipToCarlos?.toLocaleLowerCase().includes(pattern)) {
        delete resolved.relationshipToCarlos;
      }
    }
  }

  return {
    query,
    groups: [...groups.values()],
    excluded,
    ...(resolved ? { resolved } : {}),
    retrievalCount,
  };
}

/**
 * Build identity config only from canonical full-name evidence or an explicit query full name.
 * Order: Core-confirmed names (via overrides) are handled by callers; then canonical root
 * full-name evidence, then supplemental full-name evidence. Never Isabella as silent default.
 */
function deriveConfigFromEvidence(
  query: string,
  hits: readonly VaultEvidenceHit[],
): GroupIdentityConfig | undefined {
  const queryName = extractQueryPersonName(query);
  if (queryName && queryName.split(/\s+/u).length >= 2) {
    return configForFullName(queryName);
  }
  const firstName = queryName ?? undefined;
  const orderedHits = [...hits].sort((left, right) =>
    evidenceAuthorityRank(left) - evidenceAuthorityRank(right)
    || right.score - left.score
    || left.path.localeCompare(right.path));
  for (const hit of orderedHits) {
    const candidate = deduceCanonicalFullName(hit);
    if (!candidate) continue;
    const first = firstName ?? candidate.split(/\s+/u)[0]!;
    const haystack = `${hit.title} ${hit.path} ${hit.excerpt}`;
    if (!new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(first)}(?:[^\\p{L}]|$)`, 'iu').test(haystack)) {
      continue;
    }
    if (!new RegExp(escapeRegExp(candidate), 'iu').test(haystack)) {
      continue;
    }
    if (firstName && candidate.split(/\s+/u)[0]!.toLocaleLowerCase() !== firstName.toLocaleLowerCase()) {
      continue;
    }
    return configForFullName(candidate, first);
  }
  if (queryName) {
    return {
      canonicalFullName: queryName,
      firstNamePattern: new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(queryName)}(?:[^\\p{L}]|$)`, 'iu'),
      canonicalPattern: /$a/u,
      relationshipPatterns: [],
    };
  }
  return undefined;
}

function authorityRank(authority: MemoryRootAuthority | undefined): number {
  if (authority === 'canonical') return 0;
  if (authority === 'supplemental') return 1;
  return 2;
}

/** Core evidence first, then canonical roots, then supplemental — never BM25-first. */
function evidenceAuthorityRank(hit: VaultEvidenceHit): number {
  if (hit.rootId === 'core') return 0;
  if (hit.authority === 'canonical') return 1;
  if (hit.authority === 'supplemental') return 2;
  return 3;
}

function extractQueryPersonName(query: string): string | undefined {
  const normalized = query.replace(/\s+/gu, ' ').trim().replace(/[.!?]+$/u, '').trim();
  const patterns = [
    /^who(?:\s+is|['’]s)\s+(.+)$/iu,
    /^tell me who\s+(.+?)(?:\s+is)?$/iu,
    /^tell me about\s+(.+)$/iu,
    /^what do (?:we|you) know about\s+(.+)$/iu,
  ];
  for (const pattern of patterns) {
    const subject = pattern.exec(normalized)?.[1]?.trim();
    if (subject && /^[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){0,4}$/u.test(subject)) {
      return subject;
    }
  }
  if (/^[\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*){0,4}$/u.test(normalized)) {
    return normalized;
  }
  return undefined;
}

function configForFullName(fullName: string, firstName = fullName.split(/\s+/u)[0]!): GroupIdentityConfig {
  return {
    canonicalFullName: fullName,
    firstNamePattern: new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(firstName)}(?:[^\\p{L}]|$)`, 'iu'),
    canonicalPattern: new RegExp(escapeRegExp(fullName), 'iu'),
    relationshipPatterns: [
      /(?:wife|spouse|married).{0,40}carlos/iu,
      /carlos.{0,40}(?:wife|spouse|married)/iu,
    ],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function buildGroundedResultEvent(
  result: IdentityAwareRetrievalResult,
  resultId: string,
  route: KnowledgeRoute = 'private_knowledge',
  guided?: { test: 'isabella' },
  options: {
    hits?: readonly VaultEvidenceHit[];
    indexRevision?: string;
    summary?: string;
  } = {},
): GroundedResultEvent {
  const hitBySourceId = new Map(
    (options.hits ?? [])
      .filter((hit) => hit.sourceId)
      .map((hit) => [hit.sourceId!, hit]),
  );
  const provenance: GroundedResultProvenance[] = [];
  const allGroups = [...result.groups, ...result.excluded];
  for (const group of allGroups) {
    for (const item of group.provenance) {
      const hit = item.sourceId ? hitBySourceId.get(item.sourceId) : undefined;
      const sourceId = item.sourceId ?? hit?.sourceId ?? stableSourceId(item.rootId ?? 'legacy', item.relativePath);
      provenance.push({
        sourceId,
        rootId: item.rootId ?? hit?.rootId ?? 'memory',
        authority: item.authority ?? hit?.authority ?? 'canonical',
        relativePath: item.relativePath,
        title: item.title,
        excerpt: item.excerpt.slice(0, 480),
        score: item.score,
      });
    }
  }

  const { phase, confidence } = resolvePhaseAndConfidence(result);
  const conflicts = [
    ...buildConflicts(result, provenance),
    ...spouseFileConflicts(options.hits ?? [], provenance),
  ];
  const claims = buildClaims(result, provenance);
  const actions = resolveActions(result, provenance, conflicts);

  return {
    schemaVersion: 2,
    resultId,
    phase,
    route,
    subject: result.query,
    confidence,
    ...(result.resolved?.canonical ? { canonicalIdentity: result.resolved.fullName } : {}),
    ...(result.resolved?.fullName ? { fullName: result.resolved.fullName } : {}),
    ...(result.resolved?.relationshipToCarlos ? { relationship: result.resolved.relationshipToCarlos } : {}),
    ...(result.resolved?.employment?.length ? { employment: result.resolved.employment } : {}),
    ...(options.summary || defaultSummary(result) ? { summary: options.summary ?? defaultSummary(result)! } : {}),
    ...(claims.length ? { claims } : {}),
    ...(conflicts.length ? { conflicts } : {}),
    ...(options.indexRevision ? { indexRevision: options.indexRevision } : {}),
    provenance,
    actions,
    retrievalCount: result.retrievalCount,
    ...(guided ? { guided } : {}),
  };
}

function defaultSummary(result: IdentityAwareRetrievalResult): string | undefined {
  if (result.resolved?.fullName) {
    const parts = [result.resolved.fullName];
    if (result.resolved.employment?.length) parts.push(`Employment: ${result.resolved.employment.join(', ')}`);
    if (result.resolved.relationshipToCarlos) parts.push(`Relationship: ${result.resolved.relationshipToCarlos}`);
    return parts.join('. ').slice(0, 500);
  }
  if (result.excluded.length) return `Ambiguous evidence for ${result.query}`.slice(0, 500);
  return undefined;
}

function buildClaims(
  result: IdentityAwareRetrievalResult,
  provenance: readonly GroundedResultProvenance[],
): GroundedResultClaim[] {
  if (!result.resolved) return [];
  const support = provenance
    .filter((item) => result.resolved!.provenance.some((entry) =>
      entry.sourceId && entry.sourceId === item.sourceId
        ? true
        : !entry.sourceId && entry.relativePath === item.relativePath))
    .map((item) => item.sourceId);
  const claims: GroundedResultClaim[] = [{
    id: stableId('claim', result.resolved.fullName),
    text: `Identity resolves to ${result.resolved.fullName}`,
    supportSourceIds: support,
  }];
  if (result.resolved.employment?.length) {
    claims.push({
      id: stableId('claim-emp', result.resolved.employment.join(',')),
      text: `Employment: ${result.resolved.employment.join(', ')}`,
      supportSourceIds: support,
    });
  }
  if (result.resolved.relationshipToCarlos) {
    claims.push({
      id: stableId('claim-rel', result.resolved.relationshipToCarlos),
      text: `Relationship: ${result.resolved.relationshipToCarlos}`,
      supportSourceIds: support,
    });
  }
  return claims;
}

function buildConflicts(
  result: IdentityAwareRetrievalResult,
  provenance: readonly GroundedResultProvenance[],
): GroundedResultConflict[] {
  return result.excluded.flatMap((group) => group.provenance.map((item) => {
    const source = provenance.find((entry) =>
      item.sourceId && entry.sourceId === item.sourceId)
      ?? provenance.find((entry) => !item.sourceId && entry.relativePath === item.relativePath);
    return {
      id: stableId('conflict', `${item.rootId ?? ''}:${item.relativePath}`),
      claim: `First-name-only or conflicting evidence in ${item.title}`,
      reason: 'First-name-only evidence never auto-attaches to a canonical identity',
      sourceIds: source ? [source.sourceId] : [item.sourceId ?? stableSourceId(item.rootId ?? 'memory', item.relativePath)],
    } satisfies GroundedResultConflict;
  }));
}

function resolvePhaseAndConfidence(
  result: IdentityAwareRetrievalResult,
): { phase: GroundedResultPhase; confidence: AnswerConfidence } {
  const hasResolved = result.resolved && result.resolved.provenance.length > 0;
  const hasExcluded = result.excluded.length > 0;

  if (hasResolved && result.resolved!.relationshipToCarlos) {
    return { phase: 'resolved', confidence: 'strong' };
  }
  if (hasResolved) {
    return { phase: 'resolved', confidence: 'partial' };
  }
  if (hasExcluded) {
    return { phase: 'ambiguous', confidence: 'ambiguous' };
  }
  return { phase: 'unavailable', confidence: 'none' };
}

function resolveActions(
  result: IdentityAwareRetrievalResult,
  provenance: readonly GroundedResultProvenance[],
  conflicts: readonly GroundedResultConflict[],
): GroundedResultAction {
  const actions: GroundedResultAction = {};
  if (result.resolved?.provenance.length) {
    const openable = provenance.filter((item) =>
      item.rootId !== 'core'
      && result.resolved!.provenance.some((entry) =>
        entry.sourceId && entry.sourceId === item.sourceId
          ? true
          : !entry.sourceId && entry.relativePath === item.relativePath));
    if (openable.length) {
      actions.openSourceIds = openable.map((item) => item.sourceId);
      actions.reorganizeSourceIds = openable.map((item) => item.sourceId);
    }
  }
  if (conflicts.length) {
    actions.correctConflictIds = conflicts.map((conflict) => conflict.id);
  }
  return actions;
}

function normalizeFirstNameLabel(title: string, config: GroupIdentityConfig): string {
  const trimmed = title.trim();
  if (!trimmed) return '';
  if (config.canonicalPattern.test(trimmed)) return config.canonicalFullName;
  if (/^[a-z]+$/iu.test(trimmed)) return `${trimmed} (ambiguous)`;
  return trimmed;
}

function inferRelationship(
  text: string,
  config: GroupIdentityConfig,
  overrides?: CoreIdentityOverride,
): string | undefined {
  for (const relation of overrides?.confirmedRelations ?? []) {
    if (/spouse|wife|husband|partner|sister|brother|colleague/iu.test(`${relation.type} ${relation.label}`)) {
      return relation.label;
    }
  }
  for (const pattern of config.relationshipPatterns ?? []) {
    if (!pattern.test(text)) continue;
    const phrase = config.relationshipLabel ?? extractRelationshipPhrase(text) ?? 'related to Carlos Prada';
    // Spouse/wife/husband assertions require Core confirmation; other relations may use file evidence.
    if (/wife|spouse|husband|married/iu.test(phrase) || /wife|spouse|husband|married/iu.test(pattern.source)) {
      return undefined;
    }
    return phrase;
  }
  return undefined;
}

/** Collect spouse-like file claims that must surface as conflicts until Core confirms them. */
export function spouseFileConflicts(
  hits: readonly VaultEvidenceHit[],
  provenance: readonly GroundedResultProvenance[],
): GroundedResultConflict[] {
  const conflicts: GroundedResultConflict[] = [];
  for (const hit of hits) {
    const text = `${hit.title} ${hit.path} ${hit.excerpt}`;
    if (!/(?:wife|spouse|married).{0,40}carlos|carlos.{0,40}(?:wife|spouse|married)/iu.test(text)) {
      continue;
    }
    const source = provenance.find((entry) => entry.sourceId && entry.sourceId === hit.sourceId)
      ?? provenance.find((entry) => !hit.sourceId && entry.relativePath === hit.path);
    conflicts.push({
      id: stableId('conflict-spouse', `${hit.rootId ?? ''}:${hit.sourceId ?? hit.path}`),
      claim: 'Unconfirmed spouse/wife claim in source evidence',
      reason: 'Spouse claims require approved Core confirmation and are never asserted from files alone',
      sourceIds: [source?.sourceId ?? hit.sourceId ?? stableSourceId(hit.rootId ?? 'memory', hit.path)],
    });
  }
  return conflicts;
}

function extractRelationshipPhrase(text: string): string | undefined {
  const match = /(?:is\s+)?(?:the\s+)?(wife|spouse|husband|partner|sister|brother|colleague)\b(?:\s+of\s+Carlos(?:\s+Prada)?)?/iu
    .exec(text);
  return match?.[1] ? `${match[1].toLocaleLowerCase()} of Carlos Prada` : undefined;
}

function inferEmployment(text: string, config: GroupIdentityConfig): string[] {
  if (config.employmentPattern?.test(text) && config.employmentLabel) {
    return [config.employmentLabel];
  }
  const masterblox = /master\s*blox/iu.exec(text);
  if (masterblox) return ['MasterBlox'];
  return [];
}

function stableSourceId(rootId: string, relativePath: string): string {
  return createHash('sha256').update(`${rootId}:${relativePath}`).digest('hex').slice(0, 24);
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}
