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

const VALID_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9_./\s()-]*$/u;

/** Reject absolute, traversal, backslash, and invalid relative paths. */
export function isValidRelativePath(path: string): boolean {
  if (!path || path.length > 1_024) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return VALID_RELATIVE_PATH.test(path);
}

export function validateGroundedResultEvent(value: unknown): asserts value is GroundedResultEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('grounded_result must be an object');
  const e = value as Record<string, unknown>;
  const allowed = new Set([
    'resultId', 'phase', 'route', 'subject', 'confidence',
    'canonicalIdentity', 'fullName', 'relationship', 'employment',
    'provenance', 'actions', 'retrievalCount', 'guided',
  ]);
  for (const key of Object.keys(e)) {
    if (!allowed.has(key)) throw new TypeError(`grounded_result: unexpected field "${key}"`);
  }
  if (typeof e.resultId !== 'string' || !e.resultId) throw new TypeError('grounded_result.resultId must be a non-empty string');
  const validPhases = new Set(['retrieving', 'resolved', 'ambiguous', 'unavailable']);
  if (!validPhases.has(e.phase as string)) throw new TypeError('grounded_result.phase is invalid');
  const validRoutes = new Set(['private_knowledge', 'core_operational', 'general', 'clarification']);
  if (!validRoutes.has(e.route as string)) throw new TypeError('grounded_result.route is invalid');
  if (typeof e.subject !== 'string' || !e.subject || e.subject.length > 500) throw new TypeError('grounded_result.subject must be a bounded non-empty string');
  const validConfidences = new Set(['strong', 'partial', 'ambiguous', 'none']);
  if (!validConfidences.has(e.confidence as string)) throw new TypeError('grounded_result.confidence is invalid');
  for (const key of ['canonicalIdentity', 'fullName', 'relationship']) {
    if (key in e && e[key] !== undefined && (typeof e[key] !== 'string' || (e[key] as string).length > 500)) {
      throw new TypeError(`grounded_result.${key} must be a bounded string`);
    }
  }
  if (Array.isArray(e.employment)) {
    if (e.employment.length > 10) throw new TypeError('grounded_result.employment exceeds max entries');
    e.employment.forEach((item: unknown, i: number) => {
      if (typeof item !== 'string' || !item || item.length > 200) throw new TypeError(`grounded_result.employment[${i}] is invalid`);
    });
  } else if ('employment' in e) {
    throw new TypeError('grounded_result.employment must be an array');
  }
  if (!Array.isArray(e.provenance) || e.provenance.length > 50) throw new TypeError('grounded_result.provenance must be an array with at most 50 entries');
  for (const [i, item] of (e.provenance as Array<Record<string, unknown>>).entries()) {
    if (typeof item.relativePath !== 'string' || !isValidRelativePath(item.relativePath)) throw new TypeError(`provenance[${i}].relativePath is invalid`);
    if (typeof item.title !== 'string' || !item.title || item.title.length > 500) throw new TypeError(`provenance[${i}].title is invalid`);
    if (typeof item.excerpt !== 'string' || item.excerpt.length > 480) throw new TypeError(`provenance[${i}].excerpt is invalid`);
    if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) throw new TypeError(`provenance[${i}].score must be 0..1`);
  }
  if (!e.actions || typeof e.actions !== 'object' || Array.isArray(e.actions)) throw new TypeError('grounded_result.actions must be an object');
  const a = e.actions as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    if (!['open_note', 'reorganize_notes', 'correct_identity'].includes(key)) throw new TypeError(`grounded_result.actions: unexpected key "${key}"`);
  }
  if (typeof a.open_note === 'string') {
    if (!isValidRelativePath(a.open_note)) throw new TypeError('actions.open_note path is invalid');
  } else if ('open_note' in a) {
    throw new TypeError('actions.open_note must be a string');
  }
  if (typeof a.reorganize_notes === 'boolean' && a.reorganize_notes && typeof a.open_note !== 'string') {
    throw new TypeError('actions.reorganize_notes requires actions.open_note');
  }
  if ('correct_identity' in a && typeof a.correct_identity !== 'boolean') throw new TypeError('actions.correct_identity must be boolean');
  if (typeof e.retrievalCount !== 'number' || !Number.isInteger(e.retrievalCount) || e.retrievalCount < 0 || e.retrievalCount > 100) {
    throw new TypeError('grounded_result.retrievalCount must be 0..100');
  }
  if (e.guided !== undefined) {
    if (!e.guided || typeof e.guided !== 'object' || Array.isArray(e.guided)) throw new TypeError('grounded_result.guided must be an object');
    const g = e.guided as Record<string, unknown>;
    if (g.test !== 'isabella') throw new TypeError('guided.test must be "isabella"');
    if (Object.keys(g).length !== 1) throw new TypeError('guided must have exactly one key');
  }
  if (e.retrievalCount > 0 && e.phase !== 'retrieving') {
    if (JSON.stringify(e.provenance) !== JSON.stringify(e.provenance)) return;
  }
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
