# Goliath — Installation Guide

> For Pedro. Built by Mechanica (masterblox). Anti-detection browser automation for AI agents.

## What it is

Goliath has two layers:

| Layer | What | Source |
|---|---|---|
| **Camoufox Engine** | Headless browser server (Firefox fork with C++ fingerprint spoofing) | `github.com/jo-inc/camofox-browser` |
| **Goliath MCP** | Go binary that wraps the engine as an MCP stdio server (9 tools) | `github.com/masterblox/goliath` |

```
AI Agent (MCP stdio)
    │
    ▼
goliath (Go binary)       ← MCP server, 9 tools
    │  HTTP to 127.0.0.1:9377
    ▼
Camoufox Engine (Node.js)  ← Playwright + Camoufox (Firefox)
    │
    ▼
The Web (bypasses Cloudflare, Google, bot detection)
```

## Prerequisites

| Package | Why | Install |
|---|---|---|
| **Node.js ≥ 22** | Runs the engine | `nvm install 22` or system package |
| **Xvfb** | Virtual display (headless boxes) | `apt install xvfb` / `brew install xquartz` |
| **Go ≥ 1.22** | Build the goliath binary | `brew install go` / `apt install golang-go` |
| **yt-dlp** (optional) | YouTube transcript extraction | `pip install yt-dlp` |
| **~300MB disk** | Camoufox browser binary (auto-downloaded) | — |

Mac also needs: `playwright` system deps (GTK, libnotify, etc). The engine's postinstall handles most of it.

## Step 1 — Camoufox Engine

```bash
# Clone the engine
git clone https://github.com/jo-inc/camofox-browser
cd camofox-browser

# Install (downloads Camoufox ~300MB on first run)
npm install

# Start the engine
npm start
# → http://localhost:9377
```

Verify:
```bash
curl http://localhost:9377/health
# → {"status":"ok","browser":"running"}
```

Keep it running. In production, use systemd or `pm2`:
```bash
pm2 start npm --name camofox -- start
```

### Environment variables (optional but recommended)

```bash
# Port (default 9377)
export CAMOFOX_PORT=9377

# If exposing beyond localhost, set an access key
export CAMOFOX_ACCESS_KEY="your-random-key"

# Headed mode (for debugging — see what the browser is doing)
export JERICHO_HEADED=1

# Disable telemetry (private deployments)
export CAMOFOX_CRASH_REPORT_ENABLED=false
```

## Step 2 — Goliath MCP Binary

```bash
# Clone
git clone https://github.com/masterblox/goliath
cd goliath

# Build
go build -o goliath .

# Test
./goliath -version
# → goliath dev
```

The binary connects to the Camoufox engine. Default flags:

| Flag | Default | What |
|---|---|---|
| `-engine-url` | (spawns engine) | Connect to a running engine instead |
| `-port` | `9377` | Camoufox engine port |
| `-headless` | `true` | Set `false` or `JERICHO_HEADED=1` for visible window |
| `-user-id` | `jericho` | Isolated cookie jar per user |

Standard invocation (connecting to already-running engine):
```bash
./goliath -engine-url http://127.0.0.1:9377
```

## Step 3 — Wire into Hermes Agent MCP

In your Hermes `config.yaml`:

```yaml
mcp_servers:
  goliath:
    command: "/path/to/goliath"
    args: ["-engine-url", "http://127.0.0.1:9377"]
```

Restart Hermes. You should see 9 tools registered:
```
mcp_goliath_nav, mcp_goliath_js, mcp_goliath_act, mcp_goliath_find,
mcp_goliath_see, mcp_goliath_tabs, mcp_goliath_session,
mcp_goliath_media, mcp_goliath_history
```

## The 9 Tools

| Tool | What it does |
|---|---|
| `mcp_goliath_nav` | Navigate to URL. Returns snapshot. |
| `mcp_goliath_js` | Run JS in page, get JSON back. **Primary tool for SPAs.** |
| `mcp_goliath_act` | Click, type, or press key on an element (by ref or CSS selector). |
| `mcp_goliath_find` | Find elements by CSS selector (bypasses a11y tree). |
| `mcp_goliath_see` | Refresh accessibility snapshot + element refs. |
| `mcp_goliath_tabs` | List open tabs. |
| `mcp_goliath_session` | Session management (create/destroy cookie jars). |
| `mcp_goliath_media` | Screenshot capture. |
| `mcp_goliath_history` | Navigation history for a tab. |

## When to use Goliath vs regular browser

| Scenario | Use |
|---|---|
| Static pages, rich a11y tree | Regular `browser_*` tools |
| React SPAs (WeTransfer, Stripe) | **Goliath** |
| Shadow DOM, React portals | **Goliath** |
| Auth flows that keep dying | **Goliath** |
| Pages that fingerprint/block Playwright | **Goliath** |

**Core pattern**: `mcp_goliath_js` to read page state → `mcp_goliath_find` to locate elements → `mcp_goliath_act` to interact. Use `mcp_goliath_see` to refresh refs after DOM mutations.

## Quick test

```bash
# 1. Engine running on 9377
curl http://localhost:9377/health

# 2. Goliath MCP binary
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./goliath -engine-url http://127.0.0.1:9377

# 3. Navigate via MCP
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mcp_goliath_nav","arguments":{"url":"https://example.com"}}}' | ./goliath -engine-url http://127.0.0.1:9377
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `connection refused :9377` | Engine not running. Start it: `npm start` in `camofox-browser/`. |
| `Tab not found` | Tab expired (5min idle timeout). Create a new one. |
| `no element matches intent` | Use `mcp_goliath_find selector="input"` instead of `intent=`. |
| Camoufox won't launch | Check Xvfb: `Xvfb :99 -screen 0 1920x1080x24 -ac &` and `export DISPLAY=:99`. |
| `CAMOFOX_EXECUTABLE` errors | Let it auto-download. If air-gapped, point to a Camoufox bundle. |

## Production systemd unit (engine)

```ini
# /etc/systemd/system/camofox.service
[Unit]
Description=Camoufox Browser Engine
After=network.target

[Service]
Type=simple
User=pedro
WorkingDirectory=/home/pedro/camofox-browser
Environment=NODE_ENV=production
Environment=DISPLAY=:99
Environment=CAMOFOX_PORT=9377
Environment=CAMOFOX_CRASH_REPORT_ENABLED=false
Environment=CAMOFOX_ACCESS_KEY=your-random-key
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -ac
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now camofox
```

---

Built for Pedro by Carlos / Mechanica. Repos: [`jo-inc/camofox-browser`](https://github.com/jo-inc/camofox-browser) and [`masterblox/goliath`](https://github.com/masterblox/goliath).
