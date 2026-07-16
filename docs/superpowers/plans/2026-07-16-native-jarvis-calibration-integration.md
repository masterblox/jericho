# Native Jarvis Calibration Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the accepted backend and frontend calibration work into PR #20, pass every automated gate, and then guide Carlos through one genuine local hardware acceptance before the PR is declared merge-ready.

**Architecture:** Start from the verified PR #20 tip, apply the backend commit range followed by the dependent frontend range, and reconcile only shared interfaces. Automated verification uses fake clocks/synthetic fixtures; genuine acceptance is an explicit separate stage with Carlos present and no injected audio/DOM/controller events.

**Tech Stack:** Git, pnpm, TypeScript, Vitest, Playwright, Vite, Node bridge, Chromium, real MediaDevices/Gemini only during the final human gate.

---

**Required base:** `77d18fba24edc1bcf1a9b69e988a09c6c9f11417`

**Required inputs:**

- `BACKEND_BASE` and `BACKEND_TIP` from the backend plan.
- `FRONTEND_BASE` (must equal `BACKEND_TIP`) and `FRONTEND_TIP` from the frontend plan.
- Approved design commit `bb83cd2c4cf03ad0860efb92788c8d1db243a24b`.

**Prohibited:**

- Do not merge PR #20 automatically.
- Do not push the integrated PR tip until automated gates pass and Carlos confirms the genuine acceptance result.
- Do not touch live memory, populated `.env` values, repository credentials, or unrelated worktree changes.
- Do not run live microphone/camera acceptance unattended.
- Do not use fake WAV, DOM injection, controller synthesis, dummy wake, greeting reset, Gemini warmup loops, automatic phase retries, or human-duration sleeps as live evidence.

### Task 1: Establish exact ancestry and integrate commit ranges

**Files:** All files changed by accepted worker ranges plus the approved design document.

- [ ] **Step 1: Verify clean state and exact base**

```bash
git status --short
git rev-parse HEAD
git merge-base --is-ancestor 77d18fba24edc1bcf1a9b69e988a09c6c9f11417 HEAD
```

Expected: clean worktree; PR base is an ancestor. Do not reset or rename the workspace branch.

- [ ] **Step 2: Verify worker ancestry and scope**

```bash
git merge-base --is-ancestor "$BACKEND_BASE" "$BACKEND_TIP"
git merge-base --is-ancestor "$FRONTEND_BASE" "$FRONTEND_TIP"
test "$FRONTEND_BASE" = "$BACKEND_TIP"
git diff --name-only "$BACKEND_BASE...$BACKEND_TIP"
git diff --name-only "$FRONTEND_BASE...$FRONTEND_TIP"
```

Expected: backend range changes only shared/bridge/backend tests; frontend range changes only frontend/tests/screenshots.

- [ ] **Step 3: Apply backend then frontend commits**

Apply the ordered commit ranges without squashing away useful TDD boundaries. Resolve only genuine shared-interface conflicts. Do not reimplement either worker's scope.

- [ ] **Step 4: Add the approved design document**

Cherry-pick `bb83cd2` only if the exact design tree is not already present. Do not duplicate the older design commit.

- [ ] **Step 5: Verify resulting diff**

```bash
git diff --check 77d18fba24edc1bcf1a9b69e988a09c6c9f11417...
git status --short
```

### Task 2: Interface reconciliation and risk review

**Files:** Only files needed to reconcile shared/backend/frontend calibration contracts.

- [ ] **Step 1: Trace every calibration boundary**

Confirm exact agreement for:

- phrase IDs and fixed text;
- failure reasons and phase subsets;
- progress event names and ID preservation;
- proposal request/response and idempotency header;
- profile schema/version/storage key;
- command/state/gesture DOM event names;
- narration start/complete result binding.

- [ ] **Step 2: Prove authority separation**

```bash
rg -n "CoreClient|decideMission|Hermes|GitHub|Conductor|openVault|ToolExecutor" \
  apps/jarvis/frontend/src/calibration-* \
  apps/jarvis/frontend/src/audio-calibration-profile.ts \
  apps/jarvis/bridge/src/calibration
```

Expected: no executable-capability imports/calls. Explanatory strings/tests are reviewed manually.

- [ ] **Step 3: Review one-mic and no-audio-transport invariants**

Trace production construction from `EngageGate` → `JarvisRuntime` → `BridgeClient` → `MicCapture`. Confirm one audio `getUserMedia` stream, local phases force muted transport, local clap observers suppress ordinary wake, and all failure/disposal paths restore prior state.

- [ ] **Step 4: Review loop bounds**

Every phase has one timer/abort scope. Search for retry/polling/warmup logic and reject any automatic calibration retry, dummy wake, greeting mutation, recursive phase restart, or real-time sleep in tests.

### Task 3: Focused and full automated gates

**Files:** Tests only if an integration-specific regression requires correction.

- [ ] **Step 1: Run shared and bridge focused tests**

```bash
cd apps/jarvis/bridge
npx vitest run \
  tests/calibration-contracts.test.ts \
  tests/calibration-fix-proposals.test.ts \
  tests/grounded-intelligence.test.ts \
  tests/voice-gate.test.ts \
  tests/voice-isabella-rag.test.ts \
  tests/server.test.ts
```

- [ ] **Step 2: Run frontend focused tests**

```bash
cd apps/jarvis/frontend
npx vitest run \
  tests/audio-calibration.test.ts \
  tests/audio-calibration-profile.test.ts \
  tests/calibration-controller.test.ts \
  tests/calibration-events.test.ts \
  tests/calibration-proposal-client.test.ts \
  tests/bridge-client-lifecycle.test.ts \
  tests/gesture-grammar.test.ts \
  tests/jarvis-runtime.test.ts \
  tests/native-calibration-card.test.tsx \
  tests/action-parity.test.tsx
```

- [ ] **Step 3: Run full test/type/build matrix**

```bash
cd apps/jarvis/shared && pnpm typecheck
cd ../bridge && pnpm typecheck && pnpm test
cd ../frontend && pnpm typecheck && pnpm test && pnpm build
npx playwright test tests/browser/layout.spec.ts --reporter=line
git diff --check 77d18fba24edc1bcf1a9b69e988a09c6c9f11417...
```

All checks must pass. Synthetic Playwright screenshots are labelled synthetic and are not live evidence.

- [ ] **Step 4: Run failure-path audit**

Confirm tests cover every failure reason, hard timeout, proposal response, duplicate/mismatched canary event, storage failure, device loss, reduced motion, narrow geometry, and mission/calibration conflict. No failure may remain `WORKING`.

### Task 4: Prepare bounded genuine acceptance

**Files:** Gitignored evidence under `.context/acceptance-native-calibration/` only.

- [ ] **Step 1: Stop before hardware interaction**

Report automated results to Carlos and ask him to be present. Do not proceed, simulate him, or run an unattended acceptance harness.

- [ ] **Step 2: Prepare sanitized evidence and hashes**

Record build SHA, allocated Conductor port, microphone/camera permission state, and health result without secrets. Hash the repository tracked tree and eligible unified-vault Markdown files before the session. Store only digests/counts, never excerpts.

- [ ] **Step 3: Verify process ownership**

Before stopping/replacing any process, verify its PID, cwd/workspace, command, and port. Launch the integrated build on its allocated Conductor port and keep one browser tab. Preserve existing Gemini credentials and the gitignored `jericho-unified` memory root; do not print them.

### Task 5: Carlos-guided genuine local acceptance

**Files:** Gitignored screenshots/report only; browser local profile is expected.

- [ ] **Step 1: Carlos manually starts calibration**

Open Voice mode and click `CALIBRATE ROOM + MIC`. Confirm Sphere remains visible and CommandOverlay closes.

- [ ] **Step 2: Complete local phases once**

Carlos remains silent for ROOM, repeats the three displayed phrases, and makes three real claps. Verify no normal speech wakes Gemini, no phase repeats automatically, and any timeout becomes visible FAILED.

- [ ] **Step 3: Complete the real live canary**

Carlos follows the app prompt: one real clap wake, then says “Who's Isabella?” once. Verify the sanitized event log records exactly one wake, greeting-complete, capture, retrieval, retrieving result, terminal resolved result, and result-bound narration cycle.

Verify Isabella Handel and MasterBlox are supported, no supported Carlos-spouse claim appears, and excluded/conflicting relationship evidence remains visibly distinguished.

- [ ] **Step 4: Apply with a real held thumb-up**

Hold thumb-up for at least 700 ms. Confirm visible progress, exactly one apply, local profile persistence after reload, no Core mutation, and no repository/vault write.

- [ ] **Step 5: Exercise discard and terminal failure**

On a second explicitly started calibration, reach REVIEW and hold thumb-down; confirm the previous approved profile remains. Exercise one safe terminal failure, create one fix proposal, and verify its pending ID while Hermes/fleet/repository state remains unchanged.

- [ ] **Step 6: Capture visual evidence**

Capture wide and phone screenshots of representative phases and REVIEW, with no private excerpts. Record result/proposal IDs, phase durations, and event counts in a sanitized report.

- [ ] **Step 7: Compare hashes**

Recompute repository/vault hashes. They must match the before state except for intentional tracked integration commits and the browser-local approved profile outside those trees. Retrieval/calibration/proposal creation may not mutate the vault.

### Task 6: Final verdict and PR handling

**Files:** No further changes unless a verified acceptance failure requires a scoped fix and full rerun.

- [ ] **Step 1: Produce a plain-language verdict**

Report each automated and genuine gate as pass/fail. A synthetic-only result, duplicate event, unsupported relation, loop/retry, overlapping card, unwired gesture/action, proposal capability leak, or hash mutation is a hard failure.

- [ ] **Step 2: Ask Carlos before pushing the integrated PR tip**

Only after Carlos confirms the genuine acceptance result, push the branch updating PR #20. Do not merge it.

- [ ] **Step 3: Deliver final evidence**

Return:

- final full SHA and PR URL;
- exact shared/bridge/frontend/Playwright counts;
- typecheck/build/diff results;
- real result/proposal IDs without private excerpts;
- screenshot/report paths;
- before/after hash verdict;
- explicit merge/no-merge recommendation;
- exact workspaces that may be archived.
