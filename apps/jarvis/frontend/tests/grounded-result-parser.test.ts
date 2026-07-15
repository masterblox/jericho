// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { assertGroundedResultEvent } from '@jericho/shared'
import { parseGroundedResult, parseGroundedResultMessage, isSafeRelativePath, parseInterfaceSoundDetail } from '../src/grounded-result'

const V2 = {
  schemaVersion: 2,
  resultId: 'gr-1',
  phase: 'resolved',
  route: 'private_knowledge',
  subject: 'Isabella',
  confidence: 'strong',
  canonicalIdentity: 'Isabella Handel',
  fullName: 'Isabella Handel',
  employment: ['MasterBlox'],
  provenance: [
    { sourceId: 'src-1', rootId: 'People', authority: 'canonical', relativePath: 'People/Isabella Handel.md', title: 'Isabella Handel', excerpt: 'Family and MasterBlox context.', score: 0.97 },
    { sourceId: 'src-2', rootId: 'Sessions', authority: 'supplemental', relativePath: 'Sessions/Francisco.md', title: 'Francisco', excerpt: 'Isabella mention.', score: 0.42 },
  ],
  claims: [
    { id: 'cl-1', text: 'Isabella works at MasterBlox', supportSourceIds: ['src-1'] },
    { id: 'cl-2', text: 'Isabella is wife of Francisco per Sessions note', supportSourceIds: ['src-2'] },
  ],
  conflicts: [
    { id: 'conf-1', claim: 'Francisco-wife claim conflicts with MasterBlox identity', reason: 'No canonical spouse in trusted sources', sourceIds: ['src-2'] },
  ],
  actions: { openSourceIds: ['src-1'], reorganizeSourceIds: ['src-1'], correctConflictIds: ['conf-1'] },
  summary: 'Isabella Handel at MasterBlox',
  indexRevision: 'r7',
  retrievalCount: 2,
}

describe('parseGroundedResultMessage v2 (shared contract)', () => {
  it('parses valid v2 via assertGroundedResultEvent', () => {
    expect(() => assertGroundedResultEvent(V2)).not.toThrow()
    const r = parseGroundedResultMessage(V2)
    expect(r).not.toBeNull()
    expect(r!.schemaVersion).toBe(2)
    expect(r!.claims).toHaveLength(2)
    expect(r!.claims![0].id).toBe('cl-1')
    expect(r!.claims![0].supportSourceIds).toEqual(['src-1'])
    expect(r!.conflicts).toHaveLength(1)
    expect(r!.conflicts![0].id).toBe('conf-1')
    expect(r!.actions.openSourceIds).toEqual(['src-1'])
    expect(r!.indexRevision).toBe('r7')
    expect(r!.provenance[0].authority).toBe('canonical')
    expect(r!.provenance[1].authority).toBe('supplemental')
  })

  it('summary, claims, conflicts, indexRevision are all optional', () => {
    const r = parseGroundedResultMessage({
      schemaVersion: 2, resultId: 'min', phase: 'unavailable', route: 'general',
      subject: 'X', confidence: 'none', provenance: [], actions: {}, retrievalCount: 0,
    })
    expect(r).not.toBeNull()
    expect(r!.claims).toBeUndefined()
    expect(r!.conflicts).toBeUndefined()
    expect(r!.summary).toBeUndefined()
    expect(r!.indexRevision).toBeUndefined()
  })

  it('trims presentation fields without altering opaque IDs', () => {
    const r = parseGroundedResultMessage({ ...V2, subject: ' Isabella ', fullName: ' Isabella Handel ' })
    expect(r).not.toBeNull()
    expect(r!.resultId).toBe('gr-1')
    expect(r!.subject).toBe('Isabella')
    expect(r!.fullName).toBe('Isabella Handel')
  })

  it('preserves opaque IDs exactly after shared validation without trimming', () => {
    const r = parseGroundedResultMessage({
      schemaVersion: 2, resultId: 'id-with-dashes', phase: 'resolved', route: 'private_knowledge',
      subject: 'X', confidence: 'strong',
      provenance: [{ sourceId: 'src-a', rootId: 'root-x', authority: 'canonical', relativePath: 'x.md', title: 'X', excerpt: 'X.', score: 0.5 }],
      actions: { openSourceIds: ['src-a'] },
      retrievalCount: 0,
    })
    expect(r).not.toBeNull()
    expect(r!.resultId).toBe('id-with-dashes')
    expect(r!.provenance[0].sourceId).toBe('src-a')
    expect(r!.provenance[0].rootId).toBe('root-x')
    expect(r!.actions.openSourceIds).toEqual(['src-a'])
  })

  it('survives collision between two distinct result IDs without cross-contamination', () => {
    const a = parseGroundedResultMessage({
      schemaVersion: 2, resultId: 'col-a', phase: 'resolved', route: 'private_knowledge',
      subject: 'X', confidence: 'strong',
      provenance: [{ sourceId: 'src-a', rootId: 'r', authority: 'canonical', relativePath: 'x.md', title: 'X', excerpt: 'X.', score: 0.5 }],
      actions: { openSourceIds: ['src-a'] }, retrievalCount: 0,
    })
    const b = parseGroundedResultMessage({
      schemaVersion: 2, resultId: 'col-b', phase: 'ambiguous', route: 'clarification',
      subject: 'Y', confidence: 'ambiguous',
      provenance: [{ sourceId: 'src-b', rootId: 'r', authority: 'canonical', relativePath: 'y.md', title: 'Y', excerpt: 'Y.', score: 0.5 }],
      actions: {}, retrievalCount: 0,
    })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.resultId).toBe('col-a')
    expect(b!.resultId).toBe('col-b')
    expect(a!.subject).toBe('X')
    expect(b!.subject).toBe('Y')
    expect(a!.phase).toBe('resolved')
    expect(b!.phase).toBe('ambiguous')
  })

  it('rejects over-limit subject/claim/conflict/title (no truncation)', () => {
    const long = 'x'.repeat(501)
    expect(parseGroundedResultMessage({ ...V2, subject: long })).toBeNull()
    expect(parseGroundedResultMessage({ ...V2, claims: [{ id: 'c', text: long, supportSourceIds: ['src-1'] }] })).toBeNull()
    expect(parseGroundedResultMessage({
      ...V2,
      conflicts: [{ id: 'c', claim: long, reason: 'r', sourceIds: ['src-2'] }],
    })).toBeNull()
    expect(parseGroundedResultMessage({
      ...V2,
      provenance: [{ ...V2.provenance[0], title: long }],
    })).toBeNull()
  })

  it('rejects numeric indexRevision', () => {
    expect(parseGroundedResultMessage({ ...V2, indexRevision: 7 })).toBeNull()
  })

  it('rejects legacy action keys', () => {
    expect(parseGroundedResultMessage({ ...V2, actions: { open_note: 'x.md' } })).toBeNull()
    expect(parseGroundedResultMessage({ ...V2, actions: { reorganize_notes: true } })).toBeNull()
    expect(parseGroundedResultMessage({ ...V2, actions: { correct_identity: true } })).toBeNull()
  })

  it('requires schemaVersion 2', () => {
    expect(parseGroundedResultMessage({ ...V2, schemaVersion: 1 })).toBeNull()
  })

  it('rejects subjectKind as unknown field', () => {
    expect(parseGroundedResultMessage({ ...V2, subjectKind: 'person' })).toBeNull()
  })

  it('rejects reason as unknown field', () => {
    expect(parseGroundedResultMessage({ ...V2, reason: 'no evidence' })).toBeNull()
  })

  it('rejects invalid authority', () => {
    expect(parseGroundedResultMessage({ ...V2, provenance: [{ sourceId: 's', rootId: 'r', authority: 'other', relativePath: 'x.md', title: 't', excerpt: 'e', score: 0.5 }] })).toBeNull()
  })

  it('rejects claims with wrong field names', () => {
    expect(parseGroundedResultMessage({ ...V2, claims: [{ claimId: 'x', text: 't', sourceIds: ['s'] }] })).toBeNull()
  })

  it('rejects conflicts with wrong field names', () => {
    expect(parseGroundedResultMessage({ ...V2, conflicts: [{ conflictId: 'x', description: 'd', conflictingClaimIds: ['c'] }] })).toBeNull()
  })

  it('accepts guided', () => {
    expect(parseGroundedResultMessage({ ...V2, guided: { test: 'isabella' } })!.guided).toEqual({ test: 'isabella' })
  })

  it('rejects invalid guided', () => {
    expect(parseGroundedResultMessage({ ...V2, guided: { test: 'megatron' } })).toBeNull()
  })

  it('rejects unsafe provenance paths', () => {
    expect(parseGroundedResultMessage({ ...V2, provenance: [{ sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: '/etc/passwd', title: 't', excerpt: 'e', score: 0.5 }] })).toBeNull()
  })

  it('rejects invalid score', () => {
    expect(parseGroundedResultMessage({ ...V2, provenance: [{ sourceId: 's', rootId: 'r', authority: 'canonical', relativePath: 'x.md', title: 't', excerpt: 'e', score: 2 }] })).toBeNull()
  })

  it('rejects missing provenance fields', () => {
    expect(parseGroundedResultMessage({ ...V2, provenance: [{ relativePath: 'x.md', title: 't', excerpt: 'e', score: 0.5 }] })).toBeNull()
  })
})

describe('parseGroundedResult (structural)', () => {
  it('returns errors for malformed', () => {
    const r = parseGroundedResult({ resultId: '', schemaVersion: 0 })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.errors.length).toBeGreaterThan(0)
  })
  it('returns success for valid v2', () => {
    const r = parseGroundedResult(V2)
    expect(r.success).toBe(true)
    if (r.success) expect(r.payload.schemaVersion).toBe(2)
  })
})

describe('isSafeRelativePath', () => {
  it('accepts', () => { expect(isSafeRelativePath('People/x.md')).toBe(true) })
  it('rejects absolute', () => { expect(isSafeRelativePath('/etc')).toBe(false) })
  it('rejects traversal', () => { expect(isSafeRelativePath('../../x')).toBe(false) })
})

describe('parseInterfaceSoundDetail', () => {
  it('parses', () => { expect(parseInterfaceSoundDetail({ resultId: 'r', cue: 'summon' })).toEqual({ resultId: 'r', cue: 'summon' }) })
  it('rejects invalid', () => { expect(parseInterfaceSoundDetail({ resultId: 'r', cue: 'boom' })).toBeNull() })
})
