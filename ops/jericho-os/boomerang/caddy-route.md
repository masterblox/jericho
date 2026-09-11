# Boomerang webhook routing (Caddy)

The GitHub webhooks land on the same public host as the rest of the fleet
`crm.mechanica.one` Caddy vhost and are reverse-proxied to the boomerang
receiver on `127.0.0.1:9124`.

The installer (`install/install-boomerang.sh`) can add this route to
`/etc/caddy/Caddyfile` (backup-first, idempotent) and reload Caddy — or you
can wire it by hand:

```
crm.mechanica.one {
	route {
		@devgithub path /webhooks/dev/github
		handle @devgithub {
			uri strip_prefix /webhooks/dev/github
			reverse_proxy 127.0.0.1:9124
		}
		# ... existing routes ...
	}
}
```

## Registering the webhook in GitHub

Repo → Settings → Webhooks → Add webhook:

- **Payload URL:** `https://crm.mechanica.one/webhooks/dev/github`
- **Content type:** `application/json`
- **Secret:** the same value installed at `BOOMERANG_SECRET_FILE`
  (`/srv/hermes/data/boomerang/.github_secret`, `0600 root`) — the receiver
  verifies `X-Hub-Signature-256` against it on every POST.
- **Events:** `pull_request`, `workflow_run`, `push` (the receiver ignores
  everything else and acks 200 silently).
- **Active:** on.

## The receiver → bus path

```
GitHub -> Caddy (crm.mechanica.one) -> /webhooks/dev/github -> 127.0.0.1:9124
        -> github-webhook.py (HMAC verify) -> emit.py -> events.jsonl
```

- Receiver binds `127.0.0.1:9124`, POST-only, LANE-SCOPED to the boomerang
  transport layer (it never touches other lanes' config).
- Only four normalizations are frozen (everything else acks 200 without
  emitting):
  `pull_request` closed+merged → `pr_merged`; closed+unmerged →
  `pr_closed_unmerged`; `workflow_run` completed → `ci_completed`;
  push to the repo default branch → `push_main`. See `github-webhook.py`
  docstring.
- `emit.py` is the ONLY sanctioned append path to `events.jsonl` (exclusive
  flock + fsync).
