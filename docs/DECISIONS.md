# Decisions

Decisions the owner made, and design choices that follow from them. Change one only with the owner's agreement, and
record the change here with its date.

## Owner decisions

| Date | Decision | Where it shows |
| --- | --- | --- |
| Nov 2026 | **No supplier-facing page or link.** Purchasing exports the form, emails it from their own mailbox and marks it sent; the supplier replies by email and Purchasing attaches the reply. | `modules/ncf/purchasing.ts`, migration 007 |
| Nov 2026 | **The supplier's copy carries the same document and signature QR codes** as the internal print. They open only the read-only `/v` pages, which show nothing beyond what is printed. | `/print/[id]?export=1`, `src/app/v` |
| Nov 2026 | **Closing takes no verification note.** `ncf.closure_note` stays only for rows closed before migration 008. | `workflow.close`, migration 008 |
| Nov 2026 | **The supplier's reply is kept as received.** The system does not re-type or interpret the CAPA in it. | `capa_response`, Supplier Outbox |
| Nov 2026 | **NCF numbers start at 1** each period; numbers already used are skipped. Format and reset period are set in Master Settings. | `modules/ncf/numbering.ts` |
| Nov 2026 | **Indonesian national holidays and cuti bersama 2026–2027** are loaded as calendar defaults (SKB 3 Menteri); Super Admin can change them. | migration 012, Master Settings → Working calendar |
| Nov 2026 | **SAP Goods Receipt lists open receipts only** (no NCF yet, not cancelled in SAP). | migration 011 |
| 26 Nov 2026 | **UI in shadcn/ui style with the INTEC colours**, replacing the INTEC component styles (green stays the advancing action; saving is near-black instead of indigo; Geist fonts). | `components.json`, `src/app/globals.css`, `src/components/ui` |
| 26 Nov 2026 | **Database on Neon (Singapore)**, with the app moved to Railway's Singapore region alongside it; a fresh database with the demo data, not a copy of the old one. | [HANDOVER.md](HANDOVER.md) |
| 26 Nov 2026 | **SAP receipts arrive through n8n**: n8n runs the MRReg + PO query in SAP B1 and posts the rows to a write-only endpoint with an Import key; `/api/v1` stays read-only. The feed's copy of the query drops the status and open-PO filters so cancellations and quickly-closed receipts are not lost. | `integrations/n8n/README.md` |
| Nov 2026 | **The VMS is a separate platform.** It reads QMS data through the read-only API; the QMS is built to take more quality modules. | `src/app/api/v1`, [ARCHITECTURE.md](ARCHITECTURE.md) |

## Design choices

**Electronic signature by password re-entry.** Submitting and every approval re-check the signer's password at the
moment of signing; the signature stores the person, position, time and a hash of the NCF version. This is the
agreed control and is still pending compliance sign-off (UU ITE Pasal 11).

**Signing dialog.** Approve, Return and Reject each open a dialog that shows what is being signed (NCF, version,
supplier, items and defects, step), states what the signature means in Indonesian, and asks for the password. Return
and Reject need a reason; common reasons are one tap away. After approving, the approver goes straight to the next NCF
waiting for their signature. QC's submit uses the same dialog; if the form is incomplete, the missing sections are
highlighted first and no password is asked.

Alternatives considered:

- *Batch approval* (select several, one password): faster, but the approver signs NCFs they did not open. Not adopted.
- *Remember the password for a few minutes:* weakens the signature (anyone at the unlocked screen could sign). Not
  adopted.
- *Passkey or fingerprint (WebAuthn) instead of the password:* faster on phones and at least as strong. A good next
  step, but it changes the signature method and needs the owner's and compliance's agreement.

**Landing page.** Everyone lands on Home after login. It shows the work waiting for that person (drafts, NCFs to sign,
NCFs to send, overdue supplier replies, replies to verify) and one main action for their role.

**Phone navigation.** A floating bottom bar: Home, NCFs, a centre action, Alerts, Menu. The centre action follows the
person's main role:

| Role | Centre action |
| --- | --- |
| QC Inspector | New NCF (+) |
| NCF Approver (QC Manager, WHS Manager, GM) | To sign, with the count |
| Purchasing, PCH Div. Head | Supplier Outbox, with the count to send |
| Auditor, Super Admin | Reports |

A person with several roles gets the first in that order (`primaryRole`, `platform/access.ts`).
