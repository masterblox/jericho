import React from 'react'

const ACTIONS = {
  open_browser: ['Opening browser', 'Browser opened'],
  open_application: ['Opening application', 'Application opened'],
  computer_status: ['Checking screens', 'Computer status ready'],
  arrange_window: ['Arranging window', 'Window arranged'],
  inspect_repository: ['Inspecting repository', 'Repository inspected'],
  open_repository: ['Opening repository', 'Repository opened'],
  create_coding_workspace: ['Creating coding workspace', 'Workspace request opened'],
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
      const labels = ACTIONS[name]
      if (labels) show({ name, state: 'running', message: `${labels[0]}…` })
    }
    const onResult = event => {
      const name = event.detail?.name
      const labels = ACTIONS[name]
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
  }
  return errors[value] ?? 'Local action failed safely'
}
