import { randomUUID } from 'node:crypto';

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
  /** Canonical full name used as the resolved key. */
  canonicalFullName: string;
  /** Pattern that matches the first name (or any ambiguous short form). */
  firstNamePattern: RegExp;
  /** Pattern that matches the canonical full name. */
  canonicalPattern: RegExp;
  /** Optional extra patterns used to infer relationship evidence. */
  relationshipPatterns?: RegExp[];
  /** Optional pattern that matches employer/organization. */
  employmentPattern?: RegExp;
  /** Default employer label when the pattern matches. */
  employmentLabel?: string;
  /** Default relationship label when the pattern matches. */
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
    /carlos\s+prada/iu,
  ],
  employmentPattern: /master\s*blox/iu,
  employmentLabel: 'MasterBlox',
  relationshipLabel: 'wife / spouse of Carlos Prada',
};

/**
 * Group vault hits by full identity using the supplied config.
 *
 * First-name-only / partial hits stay in the `excluded` array and never
 * auto-merge into the canonical identity.
 */
export function groupIdentityEvidence(
  query: string,
  hits: readonly VaultEvidenceHit[],
  retrievalCount = 1,
  config: GroupIdentityConfig = ISABELLA_IDENTITY,
): IdentityAwareRetrievalResult {
  const groups = new Map<string, IdentityEvidenceGroup>();
  const excluded: IdentityEvidenceGroup[] = [];

  for (const hit of hits) {
    const text = `${hit.title} ${hit.path} ${hit.excerpt}`;
    if (
      !config.firstNamePattern.test(text) &&
      !config.firstNamePattern.test(hit.title) &&
      !config.firstNamePattern.test(hit.path)
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
      config.canonicalPattern.test(text) ||
      config.canonicalPattern.test(hit.title) ||
      config.canonicalPattern.test(hit.path);

    if (isCanonical) {
      const existing = groups.get(config.canonicalFullName) ?? {
        fullName: config.canonicalFullName,
        canonical: true,
        ambiguous: false,
        provenance: [],
      };
      existing.provenance.push(provenance);
      const relationship = inferRelationship(text, config);
      if (relationship) existing.relationshipToCarlos = relationship;
      const employment = inferEmployment(text, config);
      if (employment.length) {
        existing.employment = [...new Set([...(existing.employment ?? []), ...employment])];
      }
      groups.set(config.canonicalFullName, existing);
      continue;
    }

    const label = normalizeFirstNameLabel(hit.title, config) || `${config.canonicalFullName.split(/\s+/u)[0]} (ambiguous)`;
    excluded.push({
      fullName: label,
      canonical: false,
      ambiguous: true,
      provenance: [provenance],
    });
  }

  const resolved = groups.get(config.canonicalFullName);
  return {
    query,
    groups: [...groups.values()],
    excluded,
    ...(resolved ? { resolved } : {}),
    retrievalCount,
  };
}

/**
 * Build a bounded GroundedResultEvent from an IdentityAwareRetrievalResult.
 *
 * This produces the unified `grounded_result` WebSocket contract suitable
 * for both natural private questions and guided Isabella retrieval.
 */
export function buildGroundedResultEvent(
  result: IdentityAwareRetrievalResult,
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
    resultId: randomUUID(),
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
    if (result.resolved.provenance.length > 1) {
      actions.reorganize_notes = true;
    }
  }
  if (result.excluded.length > 0) {
    actions.correct_identity = true;
  }
  return actions;
}

// -- helpers ----------------------------------------------------------------

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
