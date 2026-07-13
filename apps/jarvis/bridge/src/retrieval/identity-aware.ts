import type {
  AnswerConfidence,
  GroundedResultAction,
  GroundedResultEvent,
  GroundedResultPhase,
  GroundedResultProvenance,
  IdentityAwareRetrievalResult,
  IdentityEvidenceGroup,
  IdentityEvidenceProvenance,
  KnowledgeRoute,
} from '@jericho/shared';

export interface VaultEvidenceHit {
  path: string;
  title: string;
  excerpt: string;
  score: number;
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

/** Isabella-specific identity config (private note vault). */
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

/**
 * Derive a conservative full-name candidate from vault hit titles/paths.
 * Never binds first-name-only evidence automatically.
 */
export function deduceCanonicalFullName(hit: VaultEvidenceHit): string | undefined {
  const text = `${hit.title} ${hit.path}`;
  const match = /([\p{L}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}][\p{L}\p{M}'’.-]*)+)/u.exec(text);
  if (!match) return undefined;
  const candidate = match[1].trim();
  if (candidate.split(/\s+/u).length < 2) return undefined;
  return candidate;
}

export function groupIdentityEvidence(
  query: string,
  hits: readonly VaultEvidenceHit[],
  retrievalCount = 1,
  config?: GroupIdentityConfig,
): IdentityAwareRetrievalResult {
  const effective = config ?? deriveDefaultConfig(query, hits);
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
      const relationship = inferRelationship(text, effective);
      if (relationship) existing.relationshipToCarlos = relationship;
      const employment = inferEmployment(text, effective);
      if (employment.length) {
        existing.employment = [...new Set([...(existing.employment ?? []), ...employment])];
      }
      groups.set(effective.canonicalFullName, existing);
      continue;
    }

    const label = normalizeFirstNameLabel(hit.title, effective) || `${effective.canonicalFullName.split(/\s+/u)[0]} (ambiguous)`;
    excluded.push({
      fullName: label,
      canonical: false,
      ambiguous: true,
      provenance: [provenance],
    });
  }

  const resolved = groups.get(effective.canonicalFullName);
  return {
    query,
    groups: [...groups.values()],
    excluded,
    ...(resolved ? { resolved } : {}),
    retrievalCount,
  };
}

function deriveDefaultConfig(query: string, hits: readonly VaultEvidenceHit[]): GroupIdentityConfig {
  if (/isabella\s+handel|isabella/i.test(query)) {
    return ISABELLA_IDENTITY;
  }
  const best = hits[0];
  if (!best) return ISABELLA_IDENTITY;
  const candidate = deduceCanonicalFullName(best);
  if (!candidate) return ISABELLA_IDENTITY;
  const parts = candidate.split(/\s+/u);
  const first = parts[0]!;
  const escapedFirst = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedFull = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    canonicalFullName: candidate,
    firstNamePattern: new RegExp(`(?:^|[^\\p{L}])${escapedFirst}(?:[^\\p{L}]|$)`, 'iu'),
    canonicalPattern: new RegExp(escapedFull, 'iu'),
    relationshipPatterns: [],
  };
}

export function buildGroundedResultEvent(
  result: IdentityAwareRetrievalResult,
  resultId: string,
  route: KnowledgeRoute = 'private_knowledge',
  guided?: { test: 'isabella' },
): GroundedResultEvent {
  const provenance: GroundedResultProvenance[] = [];
  const allGroups = [...result.groups, ...result.excluded];
  for (const group of allGroups) {
    for (const item of group.provenance) {
      provenance.push({
        relativePath: item.relativePath,
        title: item.title,
        excerpt: item.excerpt.slice(0, 480),
        score: item.score,
      });
    }
  }

  const { phase, confidence } = resolvePhaseAndConfidence(result);
  const actions = resolveActions(result);

  return {
    resultId,
    phase,
    route,
    subject: result.query,
    confidence,
    ...(result.resolved?.canonical ? { canonicalIdentity: result.resolved.fullName } : {}),
    ...(result.resolved?.fullName ? { fullName: result.resolved.fullName } : {}),
    ...(result.resolved?.relationshipToCarlos ? { relationship: result.resolved.relationshipToCarlos } : {}),
    ...(result.resolved?.employment?.length ? { employment: result.resolved.employment } : {}),
    provenance,
    actions,
    retrievalCount: result.retrievalCount,
    ...(guided ? { guided } : {}),
  };
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

function resolveActions(result: IdentityAwareRetrievalResult): GroundedResultAction {
  const actions: GroundedResultAction = {};
  if (result.resolved?.provenance.length) {
    const first = result.resolved.provenance[0];
    if (first?.relativePath) actions.open_note = first.relativePath;
    actions.reorganize_notes = true;
  }
  if (result.excluded.length > 0) {
    actions.correct_identity = true;
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

function inferRelationship(text: string, config: GroupIdentityConfig): string | undefined {
  for (const pattern of config.relationshipPatterns ?? []) {
    if (pattern.test(text)) return config.relationshipLabel ?? 'related to Carlos Prada';
  }
  return undefined;
}

function inferEmployment(text: string, config: GroupIdentityConfig): string[] {
  if (config.employmentPattern?.test(text) && config.employmentLabel) {
    return [config.employmentLabel];
  }
  return [];
}
