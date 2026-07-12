import type {
  IdentityAwareRetrievalResult,
  IdentityEvidenceGroup,
  IdentityEvidenceProvenance,
} from '@jericho/shared';

export interface VaultEvidenceHit {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

const CANONICAL_ISABELLA = 'Isabella Handel';
const FIRST_NAME = /(?:^|[^\p{L}])isabella(?:[^\p{L}]|$)/iu;
const FULL_CANONICAL = /isabella\s+handel/iu;
const MASTERBLOX = /master\s*blox/iu;
const WIFE_OF_CARLOS = /(?:wife|spouse|married).{0,40}carlos|carlos.{0,40}(?:wife|spouse|married)/iu;
const CARLOS_SPOUSE = /carlos\s+prada/iu;

/**
 * Group vault hits by full identity. First-name-only Isabella hits stay ambiguous
 * and never auto-merge into Isabella Handel.
 */
export function groupIdentityEvidence(
  query: string,
  hits: readonly VaultEvidenceHit[],
  retrievalCount = 1,
): IdentityAwareRetrievalResult {
  const groups = new Map<string, IdentityEvidenceGroup>();
  const excluded: IdentityEvidenceGroup[] = [];

  for (const hit of hits) {
    const text = `${hit.title} ${hit.path} ${hit.excerpt}`;
    if (!FIRST_NAME.test(text) && !FIRST_NAME.test(hit.title) && !FIRST_NAME.test(hit.path)) {
      continue;
    }
    const provenance: IdentityEvidenceProvenance = {
      relativePath: hit.path,
      title: hit.title,
      excerpt: hit.excerpt.slice(0, 480),
      score: hit.score,
    };
    const isCanonical = FULL_CANONICAL.test(text) || FULL_CANONICAL.test(hit.title) || FULL_CANONICAL.test(hit.path);
    if (isCanonical) {
      const existing = groups.get(CANONICAL_ISABELLA) ?? {
        fullName: CANONICAL_ISABELLA,
        canonical: true,
        ambiguous: false,
        provenance: [],
      };
      existing.provenance.push(provenance);
      const relationship = inferRelationship(text);
      if (relationship) existing.relationshipToCarlos = relationship;
      const employment = inferEmployment(text);
      if (employment.length) {
        existing.employment = [...new Set([...(existing.employment ?? []), ...employment])];
      }
      groups.set(CANONICAL_ISABELLA, existing);
      continue;
    }

    // First-name-only / incomplete identity: keep separate and ambiguous.
    const label = normalizeFirstNameLabel(hit.title) || 'Isabella (ambiguous)';
    excluded.push({
      fullName: label,
      canonical: false,
      ambiguous: true,
      provenance: [provenance],
    });
  }

  const resolved = groups.get(CANONICAL_ISABELLA);
  return {
    query,
    groups: [...groups.values()],
    excluded,
    ...(resolved ? { resolved } : {}),
    retrievalCount,
  };
}

function normalizeFirstNameLabel(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '';
  if (FULL_CANONICAL.test(trimmed)) return CANONICAL_ISABELLA;
  if (/^isabella$/iu.test(trimmed)) return 'Isabella (ambiguous)';
  return trimmed;
}

function inferRelationship(text: string): string | undefined {
  if (WIFE_OF_CARLOS.test(text) || (CARLOS_SPOUSE.test(text) && /wife|spouse|married/iu.test(text))) {
    return 'wife / spouse of Carlos Prada';
  }
  return undefined;
}

function inferEmployment(text: string): string[] {
  if (MASTERBLOX.test(text)) return ['MasterBlox'];
  return [];
}
