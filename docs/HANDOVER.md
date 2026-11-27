# Handover runbook

## Environment variables

| Name | Needed | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL 15+ connection string. On Neon: the pooled endpoint (host with `-pooler`), `sslmode=require` |
| `DATABASE_URL_UNPOOLED` | on Neon | The direct endpoint; `scripts/migrate.ts` uses it so schema changes bypass the pooler |
| `SESSION_SECRET` | yes | Signs login cookies; 32+ characters (`openssl rand -base64 48`). Changing it signs everyone out |
| `APP_URL` | yes | Public base URL, printed in the QR codes. Changing it breaks QRs already printed |
| `STORAGE_DIR` | yes | Evidence and reply files. The Docker image uses `/data/storage`; mount a persistent volume at `/data` |
| `JOB_SECRET` | for reminders | Header `x-job-secret` for `POST /api/jobs/reminders`; empty disables the endpoint |
| `DEFAULT_BU_CODE` | for imports | Business Unit that SAP receipts go to when no branch is mapped; the seed creates it (`INTEGRA` live) |
| `DEFAULT_BU_NAME` | with the above | Its name for the seed (`Integra Group` live) |
| `SAP_FEED_URL`, `SAP_FEED_API_KEY` | for the SAP feed | The n8n webhook the platform pulls receipts from, and its X-API-KEY ([integrations/n8n/README.md](../integrations/n8n/README.md)) |
| `SAP_FEED_SCHEDULE` | optional | `off` stops the 30-minute pull (Sync now still works) |
| `SEED_PASSWORD` | optional | Password for the demo users the seed creates (default `demo1234`). Set it on any shared server |
| `DEMO_DATA` | test servers only | `1` loads demo NCFs once at start-up. Never on real data; remove after one deploy |
| `TEST_DATABASE_URL` | tests only | Dropped and rebuilt by every `npm test` run. Never point it at a database you care about |

Secrets go in the hosting platform's variables, never in the repository (`.env.local` is ignored by git).

## Local development

```bash
cp .env.example .env.local
npm install
npm run db:migrate && npm run db:seed
npm run dev
```

Demo logins: `qc`, `qcm`, `whs`, `gm`, `pur`, `pch`, `audit`, `admin` at `@demo.local`, password `demo1234`.
The login page shows this hint only outside production.

## Checks before every merge

```bash
npm run typecheck
npx eslint src scripts tests
npm test
npm run build
python3 tests/e2e_browser.py
```

The e2e script needs the app running on port 3000 against a freshly migrated and seeded database.

## Environments and releases

| | Production | Staging (QA playground) |
| --- | --- | --- |
| URL | https://web-production-b4994f55.up.railway.app | https://web-staging-18660ff3.up.railway.app |
| Railway environment | `production` | `staging` (same service `web`, own variables) |
| Database (Neon `integra-qms`, Singapore) | `qms_prod` | `qms_staging` |
| Evidence volume | `web-volume` | `web-volume-rJwD` |
| Marked as | nothing | `APP_ENV=staging`: amber banner on every page, amber logo with STAGING · QA, `[STAGING]` in the tab title, "STAGING · TIDAK BERLAKU" watermark on printed forms |
| SAP receipts | pulled every 30 min, Mon–Sat 06:00–21:00 WIB, plus Sync now | Sync now only (`SAP_FEED_SCHEDULE=off`), to spare HANA |
| Logins | demo accounts until the real people are added | demo accounts (`@demo.local`, same password) |

Both run in Singapore (Railway `asia-southeast1-eqsg3a`, Neon `aws-ap-southeast-1`). Staging has its own
`SESSION_SECRET` and `JOB_SECRET`; nothing done there reaches production. NCFs, numbers and evidence made by QA stay in
staging.

**Release flow:** every change goes to staging first, QA checks it there, then the same commit goes to production.

```bash
railway up --service web --environment staging --detach
```

```bash
railway up --service web --environment production --detach
```

Deploy one at a time per environment: a second deploy stops the first, including a start-up that is still running.
At start-up the container runs `scripts/migrate.ts` (new migration files only) and `scripts/seed.ts` (nothing once
data exists), then `next start`; a migration therefore reaches staging's database first. Each image writes its own
`.deployment-id`, so open tabs reload after a deploy. Changing a service's region or variables without "skip deploys"
also redeploys.

**Reset staging** to a clean copy: create a new database on Neon (e.g. `qms_staging2`), point staging's
`DATABASE_URL`/`DATABASE_URL_UNPOOLED` at it and deploy; drop the old one afterwards.

**Leftover files:** `PRUNE_ORPHAN_FILES=delete` on one deploy removes evidence files that no database row points to
(`scripts/prune-files.ts`; run it without `--delete` for a dry run). Remove the variable afterwards.

**Old setup (removed 27 Nov 2026):** the first Railway Postgres (US East) and the demo databases on Neon.

For production, plan: Neon's paid plan for backups/point-in-time restore and a compute that does not suspend
(the free plan suspends when idle, so the first request after a quiet period is slower), HTTPS on the company domain,
object storage for evidence instead of a volume, and an SMTP worker for `notification_outbox`.

## Database changes

Add `db/migrations/0NN_name.sql`. Files apply in name order, once each (tracked in `schema_migrations`). Do not edit or
rename a file that has run anywhere. Take a backup before deploying a migration to a server with real data.

## SAP MRReg import

The normal route is the SAP feed: n8n queries SAP Business One and posts the rows to `POST /api/import/sap/mrreg` with
an Import API key. Setup, the query and the workflow: [integrations/n8n/README.md](../integrations/n8n/README.md). Each
batch is listed in Master Settings → API keys → SAP feed. The xlsx importer below is the fallback:

```bash
npm run import:mrreg -- path/to/mrreg-export.xlsx
```

Running it again with the same file changes nothing. It upserts suppliers by vendor code, keeps 9-digit MRReg and PO
numbers, and reports rows it skipped or repaired (for example SJ numbers Excel turned into dates). SAP exports contain
real supplier data: never commit `*.xlsx` and never use real rows as demo data.

## Daily reminders

Schedule once a day (cron, Railway cron service or Windows Task Scheduler):

```bash
curl -X POST -H "x-job-secret: $JOB_SECRET" https://<app>/api/jobs/reminders
```

It reminds Purchasing about NCFs whose supplier reply is overdue, following the window and maximum in Master
Settings. Nothing is sent to suppliers.

## API for the VMS

Create a key in Master Settings → API keys. It is shown once; only its SHA-256 is stored. Revoke it there.

```bash
curl -H "Authorization: Bearer <key>" "https://<app>/api/v1/ncfs?from=2026-01-01&to=2026-12-31&page=1&size=100"
```

```bash
curl -H "X-API-Key: <key>" "https://<app>/api/v1/responsiveness?from=2026-01-01&to=2026-12-31"
```

Filters: `from`, `to` (date raised, WIB), `status`, `supplier` (vendor code), `bu` (unit code), `page`, `size` (max
500). Drafts are never returned. The API is read-only.

## Accounts

Super Admin manages people in Master Settings → Accounts & roles: create, deactivate (records and signatures stay), reset
password, and give roles per Business Unit with an optional end date. Each approval step names one person; change it
in Master Settings → Approval chain. At least one active Super Admin always remains.
