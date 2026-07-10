# MAS-336 Resolution Report

**Date:** 2026-07-09 22:24 GST (18:24 UTC)
**Audit Agent:** Jericho (source_scoped_recovery_action wake)
**Status:** DONE — work complete on origin/main

## Prior Audit Error

Four prior audits (runs 89f242a9, 393f298a, b49296df, and one earlier) declared MAS-336 a "fabrication pattern" and reported commit 9cbe09d did not exist. ALL WERE WRONG.

Commit 9cbe09d ("[MAS-336] Route budget ask/prompt LLM calls through shared mimo client") exists on origin/main in Mechanica-Labs/architect-ai.

## Verification (2026-07-09 18:24 UTC)

| Acceptance Criterion | Status | Evidence |
|---|---|---|
| mimo.ts has response_format on CompletionOptions | PASS | `response_format?: { type: "json_object" | "text" }` on line ~56 |
| response_format conditionally forwarded to body | PASS | `if (options.response_format) { body.response_format = options.response_format; }` |
| ask/route.ts: no raw /chat/completions | PASS | Uses `mimoChat({ messages, temperature: 0.7, max_tokens: 300 })` |
| ask/route.ts: no llmUrl helper | PASS | Dead helper removed |
| prompt/route.ts: no raw /chat/completions | PASS | Uses `mimoChat({ messages, temperature: 0, response_format: { type: "json_object" } })` |
| prompt/route.ts: no llmUrl helper | PASS | Dead helper removed |
| AskResponse contract preserved | PASS | Type unchanged, stripDashes preserved, deterministic fallback intact |
| BudgetPromptResponse contract preserved | PASS | extractJsonObject/mergeLlmIntent preserved, deterministic fallback intact |

## Root Cause of False Negative

Prior audits likely checked the wrong repo (memories-express-mvp-cp) or checked before the branch was merged. The `feat/mas-336-mimo-unification-v2` branch also exists with additional commits (35eec35, 7f60414, 4e30a4c) but the core MAS-336 commit (9cbe09d) is already on main.

## Files Changed (on main)

- src/lib/llm/mimo.ts — added response_format to CompletionOptions + conditional forward
- src/app/api/budget/ask/route.ts — routed askLlm through mimoChat, deleted llmUrl
- src/app/api/budget/prompt/route.ts — routed askLlmForState through mimoChat, deleted llmUrl

## Disposition

DONE. Close as completed.
