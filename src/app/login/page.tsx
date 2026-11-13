import { FileCheck2, ShieldCheck, Timer } from "lucide-react";
import { ActionForm, Submit } from "@/components/action-form";
import { loginAction } from "./actions";

const POINTS = [
  { icon: FileCheck2, title: "One digital NCF", text: "From the goods receipt to closure, with the paper form's fields." },
  { icon: ShieldCheck, title: "Signed and traceable", text: "Electronic signatures, versions and a full audit trail." },
  { icon: Timer, title: "Responsiveness measured", text: "Supplier reply time and our own approval time, in working days." },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel, wide screens only */}
      <section className="relative hidden overflow-hidden bg-[#062c12] px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-sm bg-advance font-[family-name:var(--font-display)] text-[14px] font-bold text-advance-ink">IG</span>
          <span className="font-[family-name:var(--font-display)] text-[15px] font-bold tracking-wide">INTEGRA GROUP</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-advance">Quality Management · QMS 1</p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[34px] font-semibold leading-[1.15]">Vendor Management System</h1>
          <p className="mt-3 text-[15px] text-white/70">Non Conformity Forms for incoming material, from QC inspection to the supplier&apos;s reply.</p>
          <ul className="mt-10 flex flex-col gap-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-white/10 text-advance"><Icon size={18} aria-hidden="true" /></span>
                <span>
                  <span className="block text-[14px] font-semibold">{title}</span>
                  <span className="block text-[13px] text-white/65">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-white/45">FR/IG/ALL/IN/QUAC/007 · Internal use only</p>
      </section>

      {/* Sign-in */}
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-sm bg-advance font-[family-name:var(--font-display)] text-[14px] font-bold text-advance-ink">IG</span>
            <span className="flex flex-col leading-tight">
              <span className="font-[family-name:var(--font-display)] text-[15px] font-bold tracking-wide">INTEGRA GROUP</span>
              <span className="text-[12px] text-muted">Vendor Management System</span>
            </span>
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-[24px] font-semibold tracking-[-0.01em]">Sign in</h2>
          <p className="mt-1 text-[14px] text-muted">Use your Integra account.</p>
          <ActionForm action={loginAction} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" required className="input bg-white" placeholder="name@integragroup.co.id" />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input bg-white" />
            </div>
            <Submit className="btn btn-advance mt-1 h-11 w-full md:h-10">Sign in</Submit>
          </ActionForm>
          {/* Only on a developer machine: a public server must not advertise who can sign in. */}
          {process.env.NODE_ENV !== "production" && (
            <p className="mt-6 rounded-sm border border-dashed border-hairline bg-white px-3 py-2 text-xs text-muted">
              Demo accounts: qc, qcm, whs, gm, pur, pch, audit, admin @demo.local · password demo1234
            </p>
          )}
          <p className="mt-10 text-[12px] text-muted">Trouble signing in? Ask the PMO administrator.</p>
        </div>
      </section>
    </main>
  );
}
