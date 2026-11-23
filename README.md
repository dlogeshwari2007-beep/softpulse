# SoftPulse — Phase 1

Responsive React + TypeScript + Vite foundation: design tokens, Supabase email/password authentication, password reset and base database/RLS migration. Dashboard and advanced real-time features are intentionally deferred until approval.

## Run locally
```bash
 npm install
 cp .env.example .env.local
 # Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 npm run dev
```

## Supabase setup
1. Create a Supabase project.
2. Run `supabase/migrations/0001_base_schema.sql` in SQL Editor.
3. Enable Email authentication and add local/Vercel URLs to allowed redirect URLs.
4. Add project URL and anon key to `.env.local`. Never expose the service-role key in the browser.
5. First registered user becomes admin; subsequent users receive viewer role.

## Included
- Inter font, semantic light/dark tokens, navy/teal palette and responsive authentication views.
- Inline validation, password visibility, password reset, session persistence and sign-out.
- RLS-protected profiles, user_roles, projects, scans, modules, metrics and metric_weights tables.
- Database-owned weights for all 12 software health metrics.
- Role checks use a SECURITY DEFINER function, not browser-provided role values.

## Next checkpoint
Remaining base screens: dashboard, projects, scan detail, module report, risk ranking, scan history and admin users. Advanced real-time steps follow only after the base app is approved.