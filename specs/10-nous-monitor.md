# SPEC-10: Nous Research Release Monitor

**Subsystem:** Hermes Agent release tracking
**Source:** NEW — scaffold needed
**Target:** `/opt/data/jericho/health/versions.json`
**Frequency:** Every 6 hours
**Status:** ❌ Not built

## Integration

### What It Monitors
- Latest Hermes Agent release on GitHub (NousResearch/hermes-agent)
- Current installed version
- Changelog delta (what's in the releases we skipped)
- Breaking changes, new features (MoA, Rich Messages, etc.)

### Current State
- Running: v0.14.0 (2026.5.16)
- Latest: v0.17.0 (2026.6.19)
- Behind: 3 versions (~6 weeks)

### Jericho Wiring
1. Cron every 6h queries GitHub Releases API
2. New release detected → writes to `health/versions.json`
3. Jericho flags version drift in morning digest
4. Release notes summarized for Carlos

### Scaffold
```python
# /opt/data/scripts/nous-monitor.py
import json, urllib.request

API = "https://api.github.com/repos/NousResearch/hermes-agent/releases"
# Fetch latest, compare to installed, write delta
```

### Cron Config
```yaml
schedule: "0 */6 * * *"
script: /opt/data/scripts/nous-monitor.py
output: /opt/data/jericho/health/versions.json
```

### Upgrade Decision Flow
1. Monitor detects new release
2. Jericho reads changelog
3. If breaking changes: flag for Carlos review
4. If safe (patch/minor): prepare upgrade plan
5. Carlos approves → dispatch to DEV lane → `uv pip install --upgrade hermes-agent`

### Verification
- [ ] Detects new releases within 6h
- [ ] Changelog summarized correctly
- [ ] No false alerts on pre-releases
