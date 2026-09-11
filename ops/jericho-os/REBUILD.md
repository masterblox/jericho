# REBUILD — putting Jericho OS flows back together from this repo

Everything in `ops/jericho-os/` can be reinstalled from this repo alone. This
runbook is the full sequence for a fresh box (or after a wipe). The one thing
no repo can hold is credentials — the secret files are created by you from
env templates, never by an installer.

Ordering matters: boomerang first (it feeds everything), then continuation,
hub, pi-dispatch.

## 0. Preconditions

```sh
# a checkout of THIS repo (public) on the target box
git clone https://github.com/masterblox/jericho.git /srv/hermes/data/repos/jericho

# host root shell (installers touch /etc + systemd through it)
ssh host true
```

| Credential | Must exist before | How to create |
|---|---|---|
| GitHub webhook secret | starting the receiver | `mkdir -p /srv/hermes/data/boomerang && printf '%s' '<secret>' > /srv/hermes/data/boomerang/.github_secret && chmod 0600 /srv/hermes/data/boomerang/.github_secret` |
| Conductor API key | starting the poller | `cp ops/jericho-os/boomerang/load_conductor_env.sh.example /srv/hermes/data/scripts/load_conductor_env.sh` (set the key, `chmod 0600`) |
| Jarvis bot token | hub digest posting | normal Jarvis bot install so `TELEGRAM_BOT_TOKEN` is in `/srv/hermes/jarvis-botmode-data/.env` |

## 1. Plan, then install everything

```sh
cd /srv/hermes/data/repos/jericho
bash ops/jericho-os/install/install-all.sh --dry-run    # read the plan
bash ops/jericho-os/install/install-all.sh              # apply
```

Or per module for fine control:

```sh
bash ops/jericho-os/install/install-boomerang.sh     # bus + receiver + poller cron
bash ops/jericho-os/install/install-continuation.sh  # continuation scripts + job template
bash ops/jericho-os/install/install-hub.sh           # digest + delivery rules
bash ops/jericho-os/install/install-pi-dispatch.sh   # spool + dispatcher + lane surfaces + cron
```

Everything is idempotent and backup-first; re-running is safe.

## 2. Wire the receiver (systemd) + start

```sh
ssh host systemctl enable github-webhook
ssh host systemctl start github-webhook
ssh host systemctl status github-webhook      # should be active (running)
tail -5 /srv/hermes/data/boomerang/github-webhook.log   # "listening on 127.0.0.1:9124"
```

**Caddy route** (the public path GitHub posts to):

```sh
WITH_CADDY=1 bash ops/jericho-os/install/install-boomerang.sh   # backup + add route + validate + reload
```

…or apply `boomerang/caddy-route.md` by hand, then register the webhook in
GitHub: Payload `https://crm.mechanica.one/webhooks/dev/github`, secret = the
value in `.github_secret`, events `pull_request`, `workflow_run`, `push`.

Register the hook on **every repo whose events must reach the bus — including
`masterblox/jericho` itself.** The existing hooks on `masterblox/hermes`,
`Mechanica-Labs/mechanica-openbot`, and `Mechanica-Labs/architect-ai` do NOT
cover this repo's own PR/CI/push events; until a hook is registered here,
jericho-repo activity will not hit `events.jsonl`.

## 3. Wire the continuation cron job

The scripts are installed; the **job** (which the cron system owns) is merged
deliberately, backup-first:

```sh
python3 ops/jericho-os/install/add-continuation-job.py --dry-run
python3 ops/jericho-os/install/add-continuation-job.py \
  --jobs /srv/hermes/data/profiles/dev/cron/jobs.json \
  --scripts-dir /srv/hermes/data/profiles/dev/scripts
```

> **Warning (double-fire trap).** The helper's template id
> (`jericho-os-continuation`) is not the id of an older live copy of this
> same job (live id `aad03cdd19f5`). Against a **live** `jobs.json` that
> still holds the old job, the helper now **refuses** (exit 3) instead of
> stacking a second, concurrently-firing copy — remove or migrate the old job
> first. `--force` proceeds anyway, but never use it on a live, firing file
> unless the old job is deliberately dead.

The job runs every 2 min, uses `boomerang-finished-digest.py` as its
change-gated monitor and `boomerang-pending-completions.py` as its context
script (cheap to verify: both must sit in `SCRIPTS_DIR`).

Hub digest cron (optional, same pattern): add a `no_agent` script job calling
`hub-fleet-digest.py` every 30 min — see `hub/DELIVERY.md`.

## 4. Verify

```sh
# bus + poller
ls -l /srv/hermes/data/boomerang/events.jsonl .github_secret
bash /srv/hermes/data/boomerang/conductor-poller.py   # "baseline snapshot ... no events" (first run)

# continuation scripts parse cleanly
python3 /srv/hermes/data/profiles/dev/scripts/paseo-finished-digest.py      # PARSE-ERROR only if paseo unreachable
python3 /srv/hermes/data/profiles/dev/scripts/boomerang-pending-completions.py

# success deliveries
tail -5 /srv/hermes/data/pi-requests/_system/dispatch.log
python3 /srv/hermes/data/pi-requests/_system/dispatch.py --dry-run

# smoke + unit tests from the repo
python3 ops/jericho-os/boomerang/smoke_test.py
python3 ops/jericho-os/continuation/smoke_test.py
bash ops/jericho-os/pi-dispatch/test_cap.sh
bash ops/jericho-os/pi-dispatch/test_dispatch.sh
```

End-to-end: `python3 /srv/hermes/data/pi-requests/_system/...` send a real
request through `pi-dispatch/request.py` in any lane, watch it fire + deliver.

## 5. Moving a live host (data portability)

| Data | Copy if you want history | Abandon to rebuild |
|---|---|---|
| pi-dispatch | `/srv/hermes/data/pi-requests/` (spool: state.json, answers/, work/) | auto-recreated by `install-pi-dispatch.sh` |
| bus history | `/srv/hermes/data/boomerang/events.jsonl` | empty bus is fine (conductor first run re-baselines) |
| processed-sets | `STATE_DIR` (`*-processed.txt`, `.hub-digest-hash`) | regenerated; jobs will simply re-triage |
| secrets | `.github_secret`, `load_conductor_env.sh`, `jarvis .env` | **recreate from templates — never copy through git** |

## 6. Rollback

- Cron files: restore `.bak-<module>-<UTC>` next to each `/etc/cron.d/*`.
- Systemd: `ssh host systemctl disable --now github-webhook` and restore the
  backup unit if present.
- `jobs.json`: restore `jobs.json.bak-jericho-os-<UTC>`.
- Spool/lane surfaces: additive only — remove `pi-dispatch/` dirs per lane.

## Why no secrets in this repo

This repo is **PUBLIC**. Nothing here may be a credential, key, or token.
Every secret is a host file referenced by path, created by an operator from an
env template. Before any push: grep your diff for
`(api.?key|secret|token|password|bearer|sk-|ghp_|AKIA|ya29.|xox[bap]-)` and
mask anything that slipped through.
