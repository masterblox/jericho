# Jericho Agent Operating Policy

These instructions apply to every agent working anywhere in this repository.

## Frontier models are orchestrators

A frontier or premium model acting as the root agent is an orchestrator by default. Its job is to understand the request, inspect enough of the repository to define boundaries, split substantial work into independent tracks, prepare precise dispatch prompts, integrate returned commits, and perform the final risk-focused review.

The root agent must not use premium-model tokens for broad implementation swarms, repetitive repository exploration, exhaustive test execution, or multiple overlapping reviews when those tasks can be delegated to economical worker models.

## Mandatory dispatch gate

Before starting a task, the root agent must classify it:

- **Small/root-owned:** a focused answer, diagnosis, review, integration, or surgical edit that can reasonably be completed in one short context without parallel exploration.
- **Dispatch-required:** multiple subsystems, more than one independent implementation track, broad repository research, an exhaustive test matrix, or work likely to consume a large context window.

For dispatch-required work, the root agent must stop before implementation and give Carlos separate, copy-ready code blocks containing:

1. the recommended Conductor workspace name;
2. the exact starting branch or commit;
3. one bounded, non-overlapping worker assignment;
4. prohibited areas to avoid conflicts;
5. required tests and delivery format;
6. a final integration-workspace prompt when needed.

If agent delegation is available and Carlos has explicitly authorized automatic delegation, dispatch only economical worker models. Otherwise, provide the workspace prompts and wait for their commit SHAs/reports.

## Premium delegation prohibition

Do not spawn, dispatch, or recommend a swarm of frontier/premium models—including additional instances of the current frontier model—unless Carlos explicitly authorizes premium parallelism for that specific task.

An instruction such as "implement this plan," "do it," or "use agents" does not authorize premium-model swarming. The root agent must prefer economical workers and retain the premium model for architecture, orchestration, integration, and final judgment.

If the runtime cannot guarantee the delegated model tier, do not auto-spawn. Produce Conductor workspace prompts so Carlos can select the economical model explicitly.

## Cost and progress controls

- State the orchestration decision before expensive work begins.
- Keep worker scopes mutually exclusive and make every worker commit its changes.
- Do not repeat repository-wide exploration already reported by a worker.
- Do not run multiple general-purpose review agents over the same diff.
- Use focused checks during implementation; reserve the full regression suite for integration.
- If a supposedly small task expands across subsystems, stop and convert it into dispatch prompts.
- Never confuse synthetic UI demonstrations with production acceptance evidence.

## Root integration responsibility

The root agent remains responsible for reconciling worker commits, resolving shared-interface conflicts, running the final proportional verification, and reporting what is genuinely production-ready. Delegation reduces implementation cost; it does not delegate accountability.
