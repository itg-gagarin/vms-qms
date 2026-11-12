# VMS · NCF (QMS 1) — MVP

Digital Non Conformity Form for Integra Group, built from the Functional Design and ERD of 11–12 Nov 2026
(*Functional Design – NCF Digitalization*, tabs "FD" and "ERD · QMS to VMS").

**Flow covered:** QC creates the NCF from an MRReg → fills items, status, problem, follow-up and evidence → signs and submits
(password re-entry, versioned and hashed) → QC Manager, Material WHS Manager and GM approve in order → Purchasing sends by
email or by a generated link → the supplier answers the CAPA on a page without an account → reminders follow the window and
maximum in Settings → Purchasing or PCH Div. Head verifies and closes → two-page A4 print with a document QR and one
signature QR per approver → public QR verification pages → audit trail of every step.

**Not in this MVP:** live SAP connection (MRRegs come from the SAP export via `npm run import:mrreg`), SMTP sending
(emails are queued in the *Email outbox* screen), supplier scoring, "ask for more information", voiding after sending
(no role owns it yet), SSO.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · PostgreSQL 15+ (plain SQL migrations, `pg`) · Tailwind CSS 4.
Cache Components is switched off on purpose: every page reads the session and live data.

## Run it locally

```bash
cp .env.example .env.local        # then edit the values
npm install
npm run db:migrate                # applies db/migrations/*.sql
npm run db:seed                   # demo users, approval chain, demo receipts, calendar, settings
npm run import:mrreg -- mrreg2026.xlsx   # optional: real MRRegs from the SAP export
npm run dev                       # http://localhost:3000
```

Demo logins (password `demo1234`): `qc`, `qcm`, `whs`, `gm`, `pur`, `pch`, `audit`, `admin` — all `@demo.local`.

Reminder job, once a day (cron or Windows Task Scheduler):

```bash
curl -X POST -H "x-job-secret: $JOB_SECRET" https://<app>/api/jobs/reminders
```

## Tests

```bash
npm test                    # 20 tests against a real PostgreSQL test database (TEST_DATABASE_URL)
python3 tests/e2e_browser.py   # whole flow in Chrome, every role, with screenshots (app running on :3000)
npm run typecheck && npx eslint src scripts tests
```

`npm test` rebuilds the test database from the migrations and seed every run.

## Layout

| Path | What |
| --- | --- |
| `db/migrations/001_schema.sql` | The 33-table schema from the ERD tab, unchanged |
| `db/migrations/002_app.sql` | Login password, No. Komplain counter, QR codes as stored codes, default log partitions |
| `db/migrations/003_sap_export.sql` | Fits the current SAP MRReg export (no PO date, price, line number) |
| `src/lib/ncf.ts` | All NCF rules: create, items, evidence, submit and sign, approve, send, close |
| `src/lib/supplier.ts` | Supplier link, CAPA response, working days, reminder job |
| `src/lib/verify.ts` | QR verification, print log, settings, outbox |
| `src/app/(app)` | Internal screens (login required) |
| `src/app/s/[token]` | Supplier page, no account |
| `src/app/v` | Public QR verification pages |
| `scripts/import-mrreg.ts` | Importer for the SAP MRReg xlsx export |

Rules live in `src/lib`, not in the screens: every function checks the role and the NCF status itself.

## Known gaps to close before go-live

1. **SAP export:** no Business Unit column (all imported MRRegs go to `DEFAULT_BU_CODE`), no line number (lines are numbered by
   row order, so a re-import must keep the same order), no unit, PO date, price or requested date. Excel damaged ~200 SJ numbers
   into dates (shown as `?YYYY-MM-DD`, "check SJ").
2. **Compliance:** approval with password re-entry as electronic signature (UU ITE Pasal 11) still needs sign-off.
3. **Owner decisions:** No. Komplain format (continues the paper register, `NNN/ROMAN/YYYY`), void owner, Hold flow,
   PPIC and archive recipients, public holidays in `calendar_day`, retention.
4. **Production:** SMTP worker for `notification_outbox`, SSO, object storage for evidence, monthly partitions for
   `audit_log` and `qr_scan`, HTTPS.
