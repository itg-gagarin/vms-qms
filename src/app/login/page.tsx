import { ActionForm, Submit } from "@/components/ui/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loginAction } from "./actions";

// Sign-in only (shadcn login block): who it is for, two fields, one button.
export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-medium">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">IG</span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Integra Group</span>
            <span className="text-xs text-muted-foreground">Vendor Management System</span>
          </span>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use your work email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm action={loginAction} className="flex flex-col gap-5">
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input id="email" name="email" type="email" autoComplete="username" required className="input" placeholder="name@integragroup.co.id" />
              </div>
              <div>
                <label htmlFor="password" className="label">Password</label>
                <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
              </div>
              <Submit className="btn btn-advance w-full">Sign in</Submit>
            </ActionForm>
          </CardContent>
        </Card>
        {/* Only on a developer machine: a public server must not advertise who can sign in. */}
        {process.env.NODE_ENV !== "production" && (
          <p className="text-center text-xs text-muted-foreground">Demo: qc, qcm, whs, gm, pur, pch, audit, admin @demo.local · demo1234</p>
        )}
      </div>
    </main>
  );
}
