# Efferd Pro — Jericho frontend upgrade reference

Source artifacts staged from the hermes `sao-paulo` workspace (Efferd Pro registry
blocks). Use these as the design source for upgrading the Jericho frontend.

## Artifacts

| File | Meaning |
|---|---|
| `dashboard-9.json` | SaaS admin dashboard layout (sidebar + top nav + stat cards + revenue). Monochrome neutral. |
| `dashboard-12.json` | Bento/grid dashboard of `cn-card` blocks. |
| `dashboard-14.json` | **Chat-app layout** — left sidebar (New chat / Chats / Projects / Artifacts / Images), usage meter (`$48.20 / $100.00 · 1.2M tokens`), user menu. Closest to the Jericho chat surface. |
| `block-dashboard-*.png` | Rendered previews of the three layouts. |

The implemented reference app (`ops/fleet-dashboard/efferd-ui` in the hermes repo)
is React 19 + Vite + Tailwind v4 + shadcn/Radix. Reimplement for the Jericho
frontend (`apps/jericho/frontend`) — do not pull the whole fleet app in.

## Design tokens (from the JSON `vars`)

- `--background` `oklch(1 0 0)` · `--foreground` `oklch(0.145 0 0)`
- `--card` `oklch(1 0 0)` · `--border` `oklch(0.922 0 0)`
- `--muted` `oklch(0.97 0 0)` · `--muted-foreground` `oklch(0.556 0 0)`
- `--primary` `oklch(0.205 0 0)` · `--radius` `0.625rem`
- Charts: `--chart-1..5` neutral grays `oklch(0.87→0.269 0 0)`
- Dark mode supported (`dark:ring-0`, muted backgrounds invert); keep the
  existing light/dark theme behavior of the Jericho frontend.

## Type

- Font: **Geist** (Geist Variable), fallback to the current stack if not available.
- Body 14px/20px; headings 24px/32px weight 600; labels 12px/16px weight 400
  (`--muted-foreground`); navigation 14px weight 400/500.

## Layout grammar

- Cards: `cn-card` blocks — bordered `relative`, `overflow-hidden`, generous
  whitespace, square geometry, subtle surfaces.
- Dashboard-14 chat layout: collapsible sidebar (New chat, Chats, Projects,
  Artifacts, Images), main conversation pane, usage/status meter, user menu.
- Monochrome editorial system — no decorative gradients or themed color fills;
  single accent usage only if the Jericho identity already has one.

## Preserve (non-negotiable)

Keep the Jericho chat-first surface and the contracts in
`apps/jericho/frontend/FRONTEND_HANDOFF.md`: gesture DOM attributes, voice
`BridgeClient` wiring, `?lab=gestures`, keyboard + pointer, privacy invariants.
This is a visual/structural upgrade, not a re-architecture.
