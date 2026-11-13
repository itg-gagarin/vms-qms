@AGENTS.md

# VMS · NCF (QMS 1)

Digital Non Conformity Form for Integra Group: QC raises an NCF from an MRReg, managers approve in order, Purchasing
exports the form and emails it to the supplier themselves, records the supplier's emailed reply, and verifies and closes.
The main aims are a digital record and measuring responsiveness (supplier reply time and our approval/send times).
See README.md for the full flow, stack and known gaps.

## Commands

```bash
npm run db:migrate && npm run db:seed   # dev DB from .env.local (copy .env.example first)
npm run dev                             # http://localhost:3000, demo logins <role>@demo.local / demo1234
npm test                                # node:test suites; DROPS and rebuilds TEST_DATABASE_URL every run
npm run typecheck                       # runs `next typegen` first: LayoutProps/PageProps are generated globals
npx eslint src scripts tests
npm run build
python3 tests/e2e_browser.py            # full flow in Chrome against a running, freshly seeded app (CHROME_PATH to override)
```

`TEST_DATABASE_URL` defaults to `postgres://vms:vms@localhost:55432/vms_test`. Never point it at a database you care
about. `scripts/reset.ts` drops the `public` schema.

## Where things go

- Business rules live in `src/lib` (`ncf.ts`, `purchasing.ts`, `reports.ts`, `admin.ts`, `verify.ts`). Each function checks the caller's role and
  the NCF status itself, so screens and Server Actions stay thin. Put new rules there, not in `src/app`.
- Schema changes are new numbered files in `db/migrations/` (plain SQL, applied in order by `scripts/migrate.ts`).
  Do not edit applied migrations; `001_schema.sql` mirrors the ERD and stays unchanged.
- `src/app/(app)` is internal and needs a login; `src/app/v` (QR verification) is public and read-only, so treat what it
  receives as untrusted.
- Form fields and the printed form are Indonesian, matching the paper form (FR/IG/ALL/IN/QUAC/007); app chrome and
  status names are English. Shared labels live in `src/lib/labels.ts` (no database imports there; client code uses it).
- Times are shown in WIB (UTC+7); supplier response time is counted in working days from `calendar_day`.

## Rules

- Submitting and approving is an electronic signature (password re-entry, versioned, hashed). Do not weaken it.
- Role checks go through `hasRole`/`requireRole`/`roleScopes` in `src/lib/core.ts`, never `actor.roles` directly:
  Super Admin counts as every role there, in every module. Signatures are not roles: an approval step names one
  person, and only that person signs it, Super Admin included.
- The sidebar (`src/app/(app)/layout.tsx`) and each page's guard must use the same role list.
- Every state change writes `audit_log`. Keep that when adding actions.
- No supplier-facing page or link besides the QR codes. The supplier's copy (`/print/[id]?export=1`) carries the same
  document and signature QRs as the internal print (owner's decision); they open only the read-only `/v` pages, which must
  show nothing beyond what is printed on the form. Do not add a supplier link or upload page without the owner's decision.
- Closing takes no verification note (owner's decision); `ncf.closure_note` stays only for rows closed before 008.
- The system keeps the supplier's reply as received and does not re-type or interpret the CAPA in it.
- Styling follows the INTEC design system (README, "Design"): one `btn-advance` per screen, `btn-commit` for saves,
  `btn` (outline) for everything else; codes, quantities and dates in mono (`num`); pills only for states.
- Each department sees only its NCF stages (`STATUSES_BY_ROLE` in `core.ts`); keep lists, pages and exports on it.
- Cache Components is off on purpose (`next.config.ts`); pages read the session and live data.
- Never commit `.env.local`, `storage/`, `*.xlsx` (SAP exports hold real supplier data) or `tests/screens/`.
