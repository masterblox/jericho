# SPEC-09: Fleet Health Check

**Subsystem:** Fleet-wide health monitoring
**Source:** NEW — scaffold needed
**Target:** `/opt/data/jericho/health/{versions,errors,costs,memory}.json`
**Frequency:** Every hour
**Status:** ❌ Not built

## Integration

### What It Checks
1. **Gateway:** Process alive? Responding to health endpoint?
2. **Agent versions:** All profiles on latest? Drift detection
3. **Memory pressure:** state.db size, memory usage %
4. **Error rate:** Errors/hour vs baseline
5. **Bridge health:** Inbox/outbox file counts, staleness
6. **Disk space:** /opt/data and /opt/brain usage
7. **Provider health:** DeepSeek API reachable? Auth valid?

### Jericho Wiring
1. Cron every 1h runs fleet health check
2. Output: `health/snapshot-{timestamp}.json`
3. Jericho compares to baseline
4. Any degradation → immediate DM to Carlos
5. All-clear: silent (included in morning digest)

### Scaffold
```python
# /opt/data/scripts/fleet-health.py
import json, subprocess, os
from datetime import datetime

def check_gateway():
    # Check PID 7 alive
    pass

def check_versions():
    # Compare hermes --version vs latest GitHub release
    pass

def check_memory():
    # state.db size, memory entries %
    pass

def check_disk():
    # df -h /opt/data /opt/brain
    pass

# Output to /opt/data/jericho/health/snapshot-{timestamp}.json
```

### Alert Thresholds
- Gateway down: CRITICAL — immediate
- Version drift >1 release: HIGH — morning digest
- Memory >85%: HIGH — morning digest
- Disk >90%: CRITICAL — immediate
- Error rate >2x baseline: HIGH — morning digest

### Verification
- [ ] Runs every 1h
- [ ] Detects gateway death within 1h
- [ ] Health JSON written even when all-clear
