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
3. Immediately run `supabase/migrations/0003_first_admin_race_safety.sql` so simultaneous first signups cannot both be promoted to admin.
4. Enable Email authentication and add local/Vercel URLs to the allowed redirect URLs.
5. Add your project URL and anon/public key to `.env.local`. Never expose the service-role key in the browser.
6. Register the first account through SoftPulse. The database trigger assigns admin only while the role table is empty; later accounts receive viewer.
7. Run `supabase/migrations/0002_demo_seed.sql` to seed 3 projects, 8 scans, 40 modules and sample metrics for the first registered user.

## Phase 2 screens

- Dashboard with workspace health gauge, grade, quality indicator cards, score trend, high-risk modules and recent scans.
- Projects grid with grade/trend, text and grade filters, and validated Add Repository dialog.
- Scan detail report with Clone → Parse → Measure → Score → Report pipeline, score summary and assessment metadata.
- Authenticated `run-scan` Supabase Edge Function: reads public GitHub source, estimates the requested source metrics, calculates the weighted grade, and writes scan/module/metric records. The scanner is a first-pass heuristic analyzer, not a substitute for language-specific static analysis or a complete security audit. Coverage is measured only when an LCOV report is present; dependency freshness and vulnerability checks currently cover npm packages.
- Project cards can start a scan; the demo workspace generates sample completed assessments without contacting GitHub.
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

## Deploy the scan function

From a machine with the Supabase CLI installed and this repository cloned:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy run-scan
```

The hosted function uses the Supabase URL, anon key and service-role key injected by Supabase. An optional `GITHUB_TOKEN` function secret raises the GitHub API rate limit for repository reads. Never put the service-role key or GitHub token in Vite environment variables. Configure CORS with the `APP_ORIGIN` function secret to restrict browser requests to your deployed app origin.

## Measurement notes

The scanner intentionally limits source inspection to 140 supported source files per repository. Cyclomatic complexity, function length, nesting, duplication and maintainability are heuristic estimates based on source text. Test coverage is reported from an LCOV file when available; without one, its normalised score uses a neutral placeholder and the raw value remains unavailable. Dependency checks currently inspect npm package metadata and OSV advisories for at most 30 dependencies. Treat these results as engineering triage signals and validate important findings with your project's normal test, lint, SAST and dependency-audit tooling.

## What's not implemented yet

Phase 2 is the approved base application checkpoint. Live scan streaming across tabs, webhook autoscan, notifications, forecasting, what-if simulator, AI refactoring assistant, benchmarking, report sharing, power-user tools and reliability layer are intentionally deferred to Steps 1–10 after base-screen approval. Sample charts and measurements in demo mode are illustrative data, not analysis of a live repository.

## Deployment

Import this GitHub repository into Vercel. Use the Vite preset, build command `npm run build`, output directory `dist`, and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` in project environment variables. Apply the SQL migrations in order before using authenticated workspace data.
