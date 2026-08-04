import React from 'react'
import { BreakdownRow, JerichoCard } from './components/JerichoCard'

export function StartupHealthCard({ health, healthStatus = 'loading' }) {
  if (healthStatus === 'loading') {
    return (
      <JerichoCard className="startup-health" eyebrow="CORE STARTUP" chip="LOADING" chipTone="dim" provenance="WAITING FOR HEALTH CHECK" />
    )
  }
  if (healthStatus === 'locked') {
    return (
      <JerichoCard className="startup-health" eyebrow="CORE STARTUP" chip="LOCKED" chipTone="warn" provenance="AUTHENTICATION REQUIRED · CHECK CORE CREDENTIALS" />
    )
  }
  if (healthStatus === 'unavailable') {
    return (
      <JerichoCard className="startup-health" eyebrow="CORE STARTUP" chip="UNAVAILABLE" chipTone="critical" provenance="CORE HEALTH ENDPOINT UNREACHABLE · NOT OFFLINE" />
    )
  }
  if (healthStatus === 'degraded' && !health) {
    return (
      <JerichoCard className="startup-health" eyebrow="CORE STARTUP" chip="DEGRADED" chipTone="warn" provenance="HEALTH RESPONSE INCOMPLETE · TRY AGAIN" />
    )
  }
  if (!health) return null

  const connectors = health.connectors ?? []
  const healthy = connectors.filter(item => item.status === 'healthy').length
  const recovery = health.startup?.recovery
  if (health.ok && !recovery) {
    if (healthStatus === 'degraded') {
      return (
        <JerichoCard className="startup-health" eyebrow="CORE STARTUP" chip="DEGRADED" chipTone="warn" provenance="HEALTH OK · DEGRADED INTERMITTENTLY">
          <BreakdownRow label="DATABASE" value={health.startup?.database ?? 'REDACTED'} />
          <BreakdownRow label="VAULT" value={health.vault?.ready ? 'READY' : 'UNAVAILABLE'} />
          <BreakdownRow label="CONNECTORS" value={`${healthy}/${connectors.length} HEALTHY`} />
        </JerichoCard>
      )
    }
    return null
  }
  const status = recovery ? 'RECOVERED' : health.ok ? 'READY' : 'DEGRADED'
  const tone = status === 'READY' ? 'ok' : status === 'RECOVERED' ? 'warn' : 'critical'
  return <JerichoCard
    className="startup-health"
    eyebrow="CORE STARTUP"
    chip={status}
    chipTone={tone}
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
