import { ActionForm, Submit } from "@/components/action-form";
import { loginAction } from "./actions";

// Sign-in only: who it is for, two fields, one button.
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-sm bg-advance font-[family-name:var(--font-display)] text-[14px] font-bold text-advance-ink" aria-hidden="true">IG</span>
          <span className="flex flex-col leading-tight">
            <span className="font-[family-name:var(--font-display)] text-[15px] font-bold tracking-wide text-ink">INTEGRA GROUP</span>
            <span className="text-[12px] text-muted">Vendor Management System</span>
          </span>
        </div>
        <section className="rounded-md border border-hairline bg-white p-6">
          <h1 className="font-[family-name:var(--font-display)] text-[20px] font-semibold text-ink">Sign in</h1>
          <ActionForm action={loginAction} className="mt-5 flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input id="email" name="email" type="email" autoComplete="username" required className="input" />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
            </div>
            <Submit className="btn btn-advance mt-1 h-11 w-full md:h-10">Sign in</Submit>
          </ActionForm>
        </section>
        {/* Only on a developer machine: a public server must not advertise who can sign in. */}
        {process.env.NODE_ENV !== "production" && (
          <p className="mt-4 text-center text-xs text-muted">Demo: qc, qcm, whs, gm, pur, pch, audit, admin @demo.local · demo1234</p>
        )}
      </div>
    </main>
  );
}
