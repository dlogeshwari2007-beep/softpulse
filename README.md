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
3. Run `supabase/migrations/0003_first_admin_race_safety.sql` so simultaneous first signups cannot both be promoted to admin.
4. Run `supabase/migrations/0004_scan_realtime.sql` to add scan progress and cancellation fields and publish scans to `supabase_realtime`.
5. Run `supabase/migrations/0005_push_automation.sql` to add per-project push settings, webhook delivery idempotency and project Realtime.
6. Enable Email authentication and add local/Vercel URLs to the allowed redirect URLs.
7. Add your project URL and anon/public key to `.env.local`. Never expose the service-role key in the browser.
8. Register the first account through SoftPulse. The database trigger assigns admin only while the role table is empty; later accounts receive viewer.
9. Run `supabase/migrations/0002_demo_seed.sql` to seed 3 projects, 8 scans, 40 modules and sample metrics for the first registered user.

## Phase 2 screens

- Dashboard with workspace health gauge, grade, quality indicator cards, score trend, high-risk modules and recent scans.
- Projects grid with grade/trend, text and grade filters, and validated Add Repository dialog.
- Scan detail report with Clone → Parse → Measure → Score → Report pipeline, score summary and assessment metadata.
- Authenticated `run-scan` Supabase Edge Function: reads public GitHub source, estimates the requested source metrics, calculates the weighted grade, and writes scan/module/metric records. The scanner is a first-pass heuristic analyzer, not a substitute for language-specific static analysis or a complete security audit. Coverage is measured only when an LCOV report is present; dependency freshness and vulnerability checks currently cover npm packages.
- Project cards create a queued scan row before invoking the Edge Function, so the Scan detail page can subscribe before the analyzer begins.
- Step 1 live scan streaming: every authenticated tab subscribes to changes on `public.scans`; progress stages, current file, a bounded JSON progress log and partial health score are broadcast through Supabase Realtime.
- Step 1 cancellation: authorized admin/manager/engineer users can request cancellation; the analyzer checks the scan status at measurement and scoring checkpoints and records the cancellation.
- Step 2 live workspace: authenticated tabs subscribe to scan and project changes. A completed scan triggers a quiet workspace refresh so dashboard scores, modules and metric indicators update without a page reload.
- Step 2 push automation: each project has an Auto-scan on push setting. The public `github-webhook` Edge Function verifies `X-Hub-Signature-256`, filters to pushes on the configured default branch, uses the GitHub delivery ID to prevent duplicate scans, and invokes `run-scan` against the exact pushed commit SHA.
- Project cards include a “Simulate push” action to exercise the in-app queued scan flow. This UI simulation does not test GitHub signature verification.
- Demo workspace simulates stage and metric updates locally. Real cross-tab streaming and signed push automation require the Supabase migrations, Realtime and Edge Functions to be deployed.
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
supabase functions deploy github-webhook
```

Set two independent secrets. `GITHUB_WEBHOOK_SECRET` must match the secret configured in GitHub. `SOFTPULSE_INTERNAL_WEBHOOK_SECRET` authorises the webhook function to invoke the private scan worker with the service-role JWT. Generate two random values (for example, with `openssl rand -hex 32`) and set them:

```bash
supabase secrets set GITHUB_WEBHOOK_SECRET="YOUR_GITHUB_WEBHOOK_SECRET" SOFTPULSE_INTERNAL_WEBHOOK_SECRET="YOUR_INTERNAL_WORKER_SECRET"
```

Keep both values private; neither belongs in Vite environment variables. The included `supabase/config.toml` disables JWT verification only for `github-webhook`; that public endpoint validates GitHub’s HMAC signature itself.

For each GitHub repository, open **Settings → Webhooks → Add webhook**. Set Payload URL to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/github-webhook`, Content type to `application/json`, paste the matching webhook secret, and select **Just the push event**. Only a push to the project’s configured default branch starts a scan. You can disable this per project with its **Auto-scan on push** switch.

The hosted function uses the Supabase URL, anon key and service-role key injected by Supabase. An optional `GITHUB_TOKEN` function secret raises the GitHub API rate limit for repository reads. Never put the service-role key or GitHub token in Vite environment variables. Configure CORS with the `APP_ORIGIN` function secret to restrict browser requests to your deployed app origin.

## Step 1 and Step 2 realtime / push setup

Apply `0004_scan_realtime.sql` and `0005_push_automation.sql` before starting a scan. Supabase Realtime must be enabled for the project. Supabase Realtime must be enabled for the project, and the signed-in user needs read access to the scans table (the base migration provides authenticated scan reads through RLS). The Edge Function writes bounded progress-log events to each scan row. Cancellation changes the row status to `cancelled`; the worker stops at its next checkpoint. The browser-side cancel control is available only to admin, manager and engineer roles. This implementation is cooperative cancellation: an in-flight external HTTP request is not forcibly interrupted, but no further scan stages run after the next status check.

## Measurement notes

The scanner intentionally limits source inspection to 140 supported source files per repository. Cyclomatic complexity, function length, nesting, duplication and maintainability are heuristic estimates based on source text. Test coverage is reported from an LCOV file when available; without one, its normalised score uses a neutral placeholder and the raw value remains unavailable. Dependency checks currently inspect npm package metadata and OSV advisories for at most 30 dependencies. Treat these results as engineering triage signals and validate important findings with your project's normal test, lint, SAST and dependency-audit tooling.

## Next implementation steps

The approved base application and Steps 1–2 (live scan streaming, cooperative cancellation, live dashboard refresh and signed push-triggered scans) are implemented in the repository. Notifications, forecasting, what-if simulator, AI refactoring assistant, benchmarking, report sharing, power-user tools and reliability layer remain for the subsequent steps. Sample charts and measurements in demo mode are illustrative data, not analysis of a live repository.

## Deployment

Import this GitHub repository into Vercel. Use the Vite preset, build command `npm run build`, output directory `dist`, and set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` in project environment variables. Apply the SQL migrations in order before using authenticated workspace data.
