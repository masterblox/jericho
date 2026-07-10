# SPEC-08: DeepSeek Cost Watcher

**Subsystem:** DeepSeek API cost monitoring
**Source:** `/opt/data/scripts/watcher-deepseek.sh` + `scripts/deepseek-usage.py`
**Target:** `/opt/data/jericho/inbox/realtime/cost-{timestamp}.json`
**Frequency:** Every 6 hours
**Status:** Script exists, not scheduled

## Integration

### What It Monitors
- Daily tokens (input/output/cache)
- Daily cost in USD
- 7-day rolling average
- Spike detection (>2x vs 7-day avg)

### Jericho Wiring
1. Cron every 6h runs `watcher-deepseek.sh`
2. Output: JSON with cost breakdown
3. Jericho includes in morning digest
4. Spike >2x: immediate alert to Carlos

### Cron Config
```yaml
schedule: "0 */6 * * *"
script: /opt/data/scripts/watcher-deepseek.sh
output: /opt/data/jericho/inbox/realtime/
```

### Cost Baseline
- DEV primary: DeepSeek v4-pro @ $2.50/M input tokens
- Aux/compression: DeepSeek v4-flash
- Vision: GPT-5.5 via openai-codex (included in ChatGPT sub)
- FAL: separate, ~$2-3/week

### Future: Multi-Provider
Extend to track:
- FAL API costs (Iris image generation)
- OpenAI Codex usage (vision, delegation)
- Z.AI/GLM costs (if Iris runtime added)

### Verification
- [ ] Runs every 6h
- [ ] Costs match DeepSeek dashboard
- [ ] Spike detection triggers within 6h
