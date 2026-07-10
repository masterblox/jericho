# MAS-284 Resolution Report
## 2026-07-09

### Status: FIX ALREADY ON MAIN — no code changes needed

### Background
MAS-284 was a continuation ticket for MAS-200 (flaky e2e: ZeroBalanceInterstitial race intercepting Send/Generate clicks). The original fix (PR #85, commit `d93e1f2`) used a cookie-based dismissal approach.

### What happened
MAS-221 (PR #136, commit `48f45e4`) superseded the cookie approach with an `active` prop gate on ZeroBalanceInterstitial. The interstitial now only renders when `active=true`, which only happens on explicit Generate click at 0 balance. All cookie code was removed from both the component and the auth fixture.

### Verification (5-point chain)

1. **ZeroBalanceInterstitial.tsx:32**: `isVisible = active && data?.current === 0`
   - When `active=false` (default), component returns null immediately — no overlay

2. **DesignEditor.tsx:143,455**: `showZeroBalance` starts `false`
   - Only set `true` via `onGenerateBlockedByZeroBalance` callback — Generate-only

3. **CanvasChrome.tsx:194-196**: Callback fires only on Generate click + balance=0
   - Send button has zero balance checks, zero race surface

4. **CanvasChrome.tsx:275**: Send button → `flushThenNav("send", ...)`
   - No `balance.data?.current` check, no `onGenerateBlockedByZeroBalance` path

5. **editor-chrome.spec.ts:40,73**: Both tests click `canvas-chrome-send`
   - Neither test clicks Generate — interstitial path unreachable

### Removed dead code
- `seedZeroBalanceDismissalCookie` — removed from auth.ts (was Option B)
- `assertDismissalCookiePersisted` — removed from auth.ts
- `hasDismissed()`, `dismissalCookie()`, `dismiss()` — removed from ZeroBalanceInterstitial
- All `document.cookie` manipulation — removed

### Root cause of prior 600s timeout
Previous run (19f2c52e) likely attempted to implement the cookie approach (Option B from ticket description) which was already superseded by MAS-221. The ticket description predates the MAS-221 refactor and describes the OLD cookie-based architecture.

### Recommendation
Close MAS-284 as `done`. The fix has been on main since commit `48f45e4` (MAS-221).
