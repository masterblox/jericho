## Heartbeat: MAS-241 — Resend Domain Verification for staging email

### DNS State
sandbox-mail.masterblox.io has NO DNS records. No A, CNAME, TXT, DKIM, or SPF records. Domain does not resolve.

### Repo State (architect-ai, main)
- Branch `lofimichael/auth-config-toml-per-env` and PR #19 do NOT exist on remote
- No `supabase-config-deploy.yml` workflow existed before this heartbeat
- config.toml had SMTP commented out (old SendGrid example)
- .env.example had RESEND_FROM_EMAIL=architect@architect-ai.com
- deploy.yml had RESEND_FROM_EMAIL hardcoded instead of pulling from vars

### Changes Made (unstaged, on main)

1. NEW `.github/workflows/supabase-config-deploy.yml` — workflow_dispatch with target=staging|production, runs `supabase config push`
2. MODIFIED `supabase/config.toml` — enabled [auth.email.smtp] for Resend:
   - host=smtp.resend.com, port=465, user=resend
   - pass=env(RESEND_API_KEY)
   - admin_email=noreply@sandbox-mail.masterblox.io
   - sender_name=Terraza
3. MODIFIED `.env.example` — RESEND_FROM_EMAIL → noreply@sandbox-mail.masterblox.io
4. MODIFIED `.github/workflows/deploy.yml` — RESEND_FROM_EMAIL now from ${{ vars.RESEND_FROM_EMAIL }}

### Blocked — Needs Dashboard/DNS Access

These steps cannot be done from the VPS:

1. **Resend dashboard** — Add + verify sandbox-mail.masterblox.io domain. Add the DNS records Resend provides (1 SPF TXT + 3 DKIM CNAMEs) to masterblox.io DNS.
2. **Resend API key** — Create scoped key (Sending only, domain: sandbox-mail.masterblox.io)
3. **Vercel env vars** — Set RESEND_API_KEY + RESEND_FROM_EMAIL in Preview (and Production)
4. **GitHub Environment staging** — Add RESEND_FROM_EMAIL variable + RESEND_API_KEY secret
5. **Dispatch workflow** — Run supabase-config-deploy.yml with target=staging

### Remaining (after unblock)
- Commit changes to branch, open PR
- Run tests per issue description (signup, invite, password reset)
