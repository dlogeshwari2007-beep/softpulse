# SoftPulse — Phase 2 base application

A responsive React + TypeScript + Vite foundation for software health, quality and maintenance assessment.

## Run locally

```bash
npm install
cp .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm run dev
```

Open the local URL printed by Vite. Without Supabase environment variables, SoftPulse provides a demo workspace with sample project, scan and module data. Demo mode is for evaluation only; it is not an authenticated production workspace.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/migrations/0001_base_schema.sql` in SQL Editor.
3. Register your first account through SoftPulse. The database trigger assigns admin only if the role table is empty; later accounts receive viewer.
4. Run `supabase/migrations/0002_demo_seed.sql` in SQL Editor to seed 3 projects, 8 scans, 40 modules and their sample metrics for the first registered user.
5. Enable Email authentication and add local/Vercel URLs to the allowed redirect URLs.
6. Add your project URL and anon/public key to `.env.local`. Never expose the service-role key in the browser.

## Phase 2 screens

- Dashboard with workspace health gauge, grade, quality indicator cards, score trend, high-risk modules and recent scans.
- Projects grid with grade/trend, text and grade filters, and validated Add Repository dialog.
- Scan detail report with Clone → Parse → Measure → Score → Report pipeline, score summary and assessment metadata.
- Module inventory with filtering, sorting, risk pills, code-risk map and module detail drawer.
- Risk ranking with probability bars, estimated refactoring effort, technical debt summary and top action.
- Scan history timeline and side-by-side scan comparison.
- Admin-only user role management.
- Settings with database-backed metric weight reference, grade thresholds, theme and session controls.

## Security

- Roles live in `user_roles`, never in browser-controlled metadata.
- Role checks use the `public.has_role()` SECURITY DEFINER function with a fixed search path.
- RLS is enabled on all base tables.
- Viewers are read-only for project scan data. Only admin, manager and engineer can add repositories or create/update scan data.
- Only admins can manage user roles and metric weights.
- First-admin bootstrap is intended for a fresh Supabase project. Do not remove all role rows after launch.

## What's not implemented yet

Phase 2 is the approved base application checkpoint. The actual GitHub scanning engine / Edge Function, live scan streaming, webhook autoscan, notifications, forecasting, what-if simulator, AI refactoring assistant, benchmarking, report sharing, power-user tools and reliability layer are intentionally deferred to Steps 1–10 after base-screen approval. Sample charts and measurements in demo mode are illustrative data, not analysis of a live repository.

## Deployment

Import this GitHub repository into Vercel. Use the Vite preset, build command `npm run build`, output directory `dist`, and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` in project environment variables. Apply the SQL migrations in order before using authenticated workspace data.
