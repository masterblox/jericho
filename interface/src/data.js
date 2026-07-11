export const agents = [
  { id: 'DEV', role: 'Engineering', status: 'online', load: 72, pulse: '00:42', version: '0.18.2', x: 49, y: 21 },
  { id: 'PA', role: 'Operations', status: 'online', load: 48, pulse: '01:18', version: 'memory', x: 75, y: 35 },
  { id: 'IRIS', role: 'Design', status: 'paused', load: 8, pulse: '3d', version: 'memory', x: 77, y: 70 },
  { id: 'ANALYST', role: 'Business intel', status: 'degraded', load: 91, pulse: '05:12', version: 'external', x: 49, y: 82 },
  { id: 'RESEARCH', role: 'Research', status: 'online', load: 64, pulse: '00:20', version: '0.18.2', x: 23, y: 69 },
  { id: 'INTEL', role: 'Signals', status: 'degraded', load: 38, pulse: '07:44', version: 'external', x: 21, y: 35 },
]

export const tasks = [
  { id: 'MAS-511', title: 'Paperclip host recovery', meta: '71 deferred close records', agent: 'DEV', priority: 'critical', status: 'BLOCKED', age: '3D 14H' },
  { id: 'MAS-508', title: 'Fleet research synthesis', meta: '5 action items verified', agent: 'RESEARCH', priority: 'high', status: 'READY', age: '18H' },
  { id: 'PA-20', title: 'Michael Terraza audit', meta: 'Delivery mismatch flagged', agent: 'DEV', priority: 'high', status: 'NEW', age: '3D' },
  { id: 'PA-10', title: 'Telethon session re-auth', meta: 'Operator authorization required', agent: 'PA', priority: 'high', status: 'BLOCKED', age: '3D' },
  { id: 'DEV-56', title: 'Jericho live dashboard', meta: 'Fixture to real fleet data', agent: 'DEV', priority: 'low', status: 'NEW', age: '3D' },
]

export const signals = [
  { time: '19:22:04', source: 'PAPERCLIP', message: 'Authenticated endpoints timed out', level: 'critical' },
  { time: '19:21:18', source: 'SCHEDULER', message: 'Morning briefing lane resumed', level: 'ok' },
  { time: '19:18:32', source: 'RESEARCH', message: 'Omnigent competitive signal filed', level: 'info' },
  { time: '19:16:05', source: 'ANALYST', message: 'Stale registration wake detected', level: 'warn' },
  { time: '19:14:44', source: 'RECOVERY', message: 'Close queue retry scheduled +30m', level: 'info' },
]

export const navItems = ['COMMAND', 'MISSIONS', 'SIGNALS']

export const system = { uptimeHours: 54, uptimeMax: 72, deferred: 71 }
