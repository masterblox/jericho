import React from 'react'
import { BreakdownRow, JerichoCard } from './components/JerichoCard'

export function StartupHealthCard({ health }) {
  if (!health) return <JerichoCard className="startup-health" eyebrow="CORE STARTUP" chip="OFFLINE" chipTone="critical" provenance="HEALTH · UNAVAILABLE" />
  const connectors = health.connectors ?? []
  const healthy = connectors.filter(item => item.status === 'healthy').length
  const recovery = health.startup?.recovery
  const status = recovery ? 'RECOVERED' : health.ok ? 'READY' : 'DEGRADED'
  return <JerichoCard
    className="startup-health"
    eyebrow="CORE STARTUP"
    chip={status}
    chipTone={status === 'READY' ? 'ok' : status === 'RECOVERED' ? 'warn' : 'critical'}
    provenance={recovery ? 'ARCHIVED · NOT MIGRATED' : 'PERSISTENT LOCAL CORE'}
  >
    <BreakdownRow label="DATABASE" value={health.startup?.database ?? 'REDACTED'} />
    <BreakdownRow label="NEW CORE" value={health.startup?.initializedNewCore ? 'INITIALIZED' : 'NO'} />
    <BreakdownRow label="VAULT" value={health.vault?.ready ? 'READY' : 'UNAVAILABLE'} />
    <BreakdownRow label="CONNECTORS" value={`${healthy}/${connectors.length} HEALTHY`} />
    {recovery && <BreakdownRow label="ARCHIVE" value={safeArchive(recovery.archive)} />}
  </JerichoCard>
}

function safeArchive(value) {
  return typeof value === 'string' && value.startsWith('~/.jericho/recovery/')
    ? value
    : 'REDACTED'
}
