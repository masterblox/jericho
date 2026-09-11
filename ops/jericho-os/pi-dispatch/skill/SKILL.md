---
name: pi-dispatch
description: Ask the fleet's Pi worker lane for engineering help without leaving your lane. Use when you need a focused coding/reviewing/auditing task done by an independent worker (repo read, bug hunt, repo audit, small build, bulk analysis) and want the result back in your lane's answers folder. Trigger phrases: "ask Pi to", "dispatch to Pi", "pi-dispatch", "get Pi on this", "worker verdict".
metadata:
  version: 1.0.0
  fleet: hermes
---

# pi-dispatch — engineering help on demand, from your lane

Every fleet lane can hand an engineering-heavy task to a disposable Pi worker.
You write **one request file** into your own lane's `pi-dispatch/` folder. A
host-side dispatcher detects it, launches a Paseo Pi tab **labeled with your
lane**, tracks it to completion, and writes the answer back. You never touch
Paseo, never leave your lane, and never relay through Carlos.

## When to use

- A focused task your own home-grown work would flood (repo reads, audits,
  bug hunts, verifying a claim, a small build in a scratch dir).
- Work that should run with **independence** — a second opinion from a
  different model family.
- Any task that must not consume your context window.

When **not** to use: anything needing your credentials, anything that must
emit a chat to a client or to Carlos (the worker answers to files only and is
forbidden from notifying anyone), or anything touching `/repos` (read-only).

## How to request (one command)

Your lane's `pi-dispatch/` folder lives at the top of your own data root:

```
python3 pi-dispatch/request.py "Review the script at /srv/hermes/data/scratch/foo/sample.py and tell me the bug, with a one-line fix." --title "review sample.py"
```

That writes `pi-dispatch/requests/<id>.json`. The dispatcher picks it up
within ~2 minutes (host cron). Keep prompts **self-contained**: the worker
runs in its own sandbox and can read absolute paths you name on this box.

## Checking on it

```
python3 pi-dispatch/request.py --status      # queued + answered ids
```

The answer lands (a few minutes, sometimes longer for big tasks) at:

```
pi-dispatch/answers/<id>.md
```

Same file also lives in the canonical spool at
`/srv/hermes/data/pi-requests/<lane>/answers/<id>.md`.

If a request has no answer after ~6 hours it is marked **STALE** in the answer
file instead of silently disappearing — re-request if you still need it.

## Guardrails (non-negotiable)

- **Never** put API keys, tokens, passwords, or secrets in a task prompt or
  title. The request file is plaintext on the host and the worker prompt is a
  remote model. Requests that look like they contain a secret get
  **quarantined, not fired**.
- The worker has **no chat access and is told to notify nobody.** Your answer
  is a file. If a downstream step needs a human, route it through hub rules —
  do not ask Pi to message anyone.
- The worker only writes inside its sandbox; `/repos` is read-only. Point it
  at scratch dirs (`/srv/hermes/data/scratch/...`) or a copy, never at a repo
  you care about with write intent (you can ask it to READ a repo and report).
- Verify the answer before repeating it — a worker report is a claim, not a
  fact. Open cited `file:line` references yourself.
- You request; you don't run host commands, and you don't fire Paseo tabs.
  That is the dispatcher's job. Least power.

## Where the machinery lives (for your understanding, not to edit)

- Lane surface: `<your-home>/pi-dispatch/` (`request.py`, `requests/`, `answers/`).
- Canonical spool + dispatcher + logs:
  `/srv/hermes/data/pi-requests/` (`dispatch.py`, `_system/dispatch.log`,
  `<lane>/{inbox,answers,work}/`).
- Host cron: `/etc/cron.d/pi-dispatch` (every 2 min).
- Source + runbook: `ops/jericho-os/pi-dispatch/` in the hermes fleet repo.
