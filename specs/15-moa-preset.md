# SPEC-15: MoA Preset (Jericho)

**Subsystem:** Mixture of Agents virtual model
**Source:** `config.yaml` moa section
**Target:** Available via `/moa` or `/model jericho --provider moa`
**Frequency:** On-demand (model switch)
**Status:** ✅ Configured

## Integration

### Preset Configuration
```yaml
moa:
  default_preset: jericho
  presets:
    jericho:
      reference_models:
        - provider: openai-codex
          model: gpt-5.5
      aggregator:
        provider: deepseek
        model: deepseek-v4-pro
      reference_temperature: 0.6
      aggregator_temperature: 0.4
      max_tokens: 4096
```

### How It Works
- GPT-5.5 provides reference analysis (cheap, no tools, no system prompt)
- DeepSeek v4-pro aggregates and responds normally (full tool access)
- Prompt caching preserved — no cache invalidation

### Usage
```
/moa                    → switch to Jericho MoA permanently
/moa jericho            → explicit
/moa <any prompt>       → one-shot Jericho MoA for this turn
```

### Cost
- Reference calls: GPT-5.5 via openai-codex (included in ChatGPT sub)
- Aggregator: DeepSeek v4-pro (normal cost)
- Extra cost per turn: ~negligible (reference calls are small, trimmed)

### Future Presets
Additional Jericho presets for specific task types:
- `jericho-review`: Opus aggregator for code review (needs Anthropic/OpenRouter key)
- `jericho-design`: Opus aggregator for design judgment (needs Anthropic/OpenRouter key)
- `jericho-research`: Multiple DeepSeek variants as references

### Verification
- [ ] `/moa` switches to Jericho preset
- [ ] Reference calls appear in logs
- [ ] No cache breaks on model switch
