# Vault RAG gateway

**Owner:** Carlos / Jericho Core

**Freshness:** reviewed 2026-07-11.

Jericho's laptop Core never receives arbitrary command authority on Hermes. A
narrow authenticated service beside `/opt/brain` owns exactly three operations:
vault search, Git-backed health, and index rebuild.

## Deployment

1. Deploy this repository at `/opt/jericho` and install
   `ops/vault/vault-rag.py` as `/opt/data/scripts/jericho-vault-rag.py` mode
   `0755`. Do not overwrite `/opt/data/scripts/vault-rag.py`.
2. Copy `ops/vault/jericho-vault-gateway.env.example` to
   `/etc/jericho/vault-gateway.env`, set a unique token, and apply mode `0600`.
3. Install `ops/vault/jericho-vault-gateway.service` under systemd. Keep the
   listener loopback-only behind the existing private HTTPS/Tailscale proxy.
4. Configure the laptop with `JERICHO_VAULT_GATEWAY_URL` and the same token.
   Never place the token in Git, logs, URLs, process arguments, or Obsidian.

The gateway paths are fixed by environment at startup. Requests cannot choose
an executable, script, vault, index, cache, or Git repository path.

The existing live script inspected on 2026-07-11 had SHA-256
`abd84ad51355bc45d34e1a5abc21571fdcd84de2c6002b7a9ed23b531f44bd42` and
implements legacy grep search for existing callers. It remains untouched. The
separately named Jericho BM25 script supports a compatibility JSON-array mode,
but the gateway uses only `index --json` and structured `search … --json`.

## Runtime behavior

- Search calls the vendored BM25 CLI in JSON mode and caches normalized results
  in `/opt/data/jericho/intel/rag-cache.json` for 24 hours.
- A successful rebuild atomically updates index metadata and clears query cache.
- Every ten minutes, the laptop checks remote health. Between 01:00 and 05:00
  UTC it rebuilds once when a healthy vault commit is newer than the index.
- Vault commits older than one hour surface as degraded connector health. Git
  errors or an unavailable gateway surface as unavailable.
- Jericho never pulls, pushes, resets, merges, or resolves the vault repository.

## Verification

Run `pnpm test && pnpm typecheck && pnpm build` from `apps/jericho`. On the
droplet, verify the gateway through the private proxy and confirm that its
health response contains timestamps and counts only—never note bodies or
absolute private paths.
