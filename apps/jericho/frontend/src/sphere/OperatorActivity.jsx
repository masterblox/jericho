import React from 'react'

const ACTIONS = {
  open_browser: ['Opening browser', 'Browser opened'],
  open_application: ['Opening application', 'Application opened'],
  computer_status: ['Checking screens', 'Computer status ready'],
  arrange_window: ['Arranging window', 'Window arranged'],
  inspect_repository: ['Inspecting repository', 'Repository inspected'],
  open_repository: ['Opening repository', 'Repository opened'],
  create_coding_workspace: ['Queueing coding task', 'Coding task queued for Conductor'],
  coding_agent_status: ['Checking coding agent', 'Coding agent status ready'],
  steer_coding_agent: ['Steering coding agent', 'Coding agent steered'],
  cancel_coding_agent: ['Stopping coding agent', 'Coding agent stopped'],
  open_wifi_mapping: ['Opening Wi-Fi observatory', 'Wi-Fi observatory opened on the secondary display'],
}

export function OperatorActivity() {
  const [activity, setActivity] = React.useState(null)

  React.useEffect(() => {
    let dismiss
    const show = next => {
      clearTimeout(dismiss)
      setActivity(next)
      if (next.state !== 'running') dismiss = setTimeout(() => setActivity(null), 7000)
    }
    const onStart = event => {
      const name = event.detail?.name
      const labels = ACTIONS[name] ?? (String(name).startsWith('mcp_') ? ['Running MCP tool', 'MCP tool complete'] : null)
      if (labels) show({ name, state: 'running', message: `${labels[0]}…` })
    }
    const onResult = event => {
      const name = event.detail?.name
      const labels = ACTIONS[name] ?? (String(name).startsWith('mcp_') ? ['Running MCP tool', 'MCP tool complete'] : null)
      if (!labels) return
      const result = event.detail?.result ?? {}
      const failed = result.available === false || result.status === 'failed'
      show({
        name,
        state: failed ? 'failed' : 'succeeded',
        message: failed ? actionError(result.error) : result.summary ?? labels[1],
      })
    }
    document.addEventListener('jericho:voice-tool-start', onStart)
    document.addEventListener('jericho:voice-tool-result', onResult)
    return () => {
      clearTimeout(dismiss)
      document.removeEventListener('jericho:voice-tool-start', onStart)
      document.removeEventListener('jericho:voice-tool-result', onResult)
    }
  }, [])

  if (!activity) return null
  return <div className="operator-activity" data-state={activity.state} role="status" aria-live="polite">
    <i aria-hidden="true" />
    <span>{activity.message}</span>
  </div>
}

function actionError(value) {
  const errors = {
    accessibility_permission_required: 'Allow Jericho in System Settings → Privacy & Security → Accessibility',
    automation_permission_required: 'Allow Jericho to control Chrome in System Settings → Privacy & Security → Automation',
    application_has_no_windows: 'That application has no window to arrange',
    application_not_running: 'That application is not running',
    local_operator_unavailable: 'Local computer control is unavailable',
    repository_not_configured: 'That repository is not configured for Jericho',
    conductor_auth_required: 'Run conductor auth login once to enable coding workspaces',
    speaker_verification_required: 'Owner voice verification is required before tools can run',
    voice_authority_unavailable: 'The active voice authority expired; wake Jericho and try again',
    secondary_display_required: 'Connect a second display for the Wi-Fi observatory',
  }
  return errors[value] ?? 'Local action failed safely'
}
