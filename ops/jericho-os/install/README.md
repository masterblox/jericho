# Jericho OS installers

All four flows install from this directory. Every installer is **idempotent**,
**backup-first**, and supports **`--dry-run`** (print the plan, change
nothing). Secrets are never created by an installer — env templates only.

## Quick start

```sh
bash ops/jericho-os/install/install-all.sh --dry-run   # plan only
bash ops/jericho-os/install/install-all.sh             # install everything
```

Or per module:

```sh
bash ops/jericho-os/install/install-boomerang.sh     [--dry-run]
bash ops/jericho-os/install/install-continuation.sh  [--dry-run]
bash ops/jericho-os/install/install-hub.sh           [--dry-run]
bash ops/jericho-os/install/install-pi-dispatch.sh   [--dry-run]
```

## What each installer does

| Installer | Installs | Touches host? |
|---|---|---|
| `install-boomerang.sh` | receiver + `emit.py` + poller + event scripts into `BOOMERANG_ROOT` / `SCRIPTS_DIR`; systemd `github-webhook.service`; poller cron `/etc/cron.d/boomerang-conductor` | yes (`/etc/systemd`, `/etc/cron.d` via `ssh host`, backup-first) |
| `install-continuation.sh` | `paseo-finished-digest.py`, `paseo-pending-completions.py`, `paseo-mark-processed.py`, `continuation-job.json` template into `SCRIPTS_DIR` | no cron/service changes |
| `install-hub.sh` | `hub-fleet-digest.py` + `DELIVERY.md` | no |
| `install-pi-dispatch.sh` | delegates to the canonical `../pi-dispatch/install.sh` (spool, dispatcher, lane surfaces, skills, cron `/etc/cron.d/pi-dispatch`) | yes (cron) |

## Required secrets / config (NOT created by installers)

| What | Where | How |
|---|---|---|
| GitHub webhook secret | `$BOOMERANG_ROOT/.github_secret` (0600 root) | `printf '%s' '<secret>' > .github_secret` |
| Conductor API key | `$CONDUCTOR_ENV_LOADER` (default `/srv/hermes/data/scripts/load_conductor_env.sh`) | copy `boomerang/load_conductor_env.sh.example`, set `CONDUCTOR_API_KEY` |
| Jarvis bot token | `$JARVIS_ENV` (`/srv/hermes/jarvis-botmode-data/.env`) | normal Jarvis bot install; digest reads `TELEGRAM_BOT_TOKEN` at runtime |
| Caddy webhook route | `/etc/caddy/Caddyfile` | `WITH_CADDY=1 bash install-boomerang.sh` (backup + validate + reload), or hand-apply `boomerang/caddy-route.md` |

## Continuation cron job (deliberately separate)

The three continuation scripts install silently, but the **job** that runs
them lives in a lane's `cron/jobs.json`, which the cron system owns. To make
it live after a rebuild — explicitly, backup-first, idempotent:

```sh
python3 ops/jericho-os/install/add-continuation-job.py --dry-run
python3 ops/jericho-os/install/add-continuation-job.py \
  --jobs /srv/hermes/data/profiles/dev/cron/jobs.json \
  --scripts-dir /srv/hermes/data/profiles/dev/scripts
```

The helper reuses the same id, never duplicates, and backs up `jobs.json`
before touching it. The hub digest cron is wired the same way
(`hub-fleet-digest.py` as a `no_agent` script job); see `REBUILD.md`.

## Path configuration

Defaults are the canonical live paths on this host. Override via env for a
different box: `JERICHO_ROOT`, `BOOMERANG_ROOT`, `SCRIPTS_DIR`, `STATE_DIR`,
`HUB_DIR`, `JARVIS_ENV`, `PI_SPOOL`.
