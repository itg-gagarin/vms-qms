"use client";

import { CircleAlert } from "lucide-react";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ActionState = { error?: string; ok?: string; link?: string; n?: number };
type Action = (prev: ActionState, data: FormData) => Promise<ActionState>;

const Pending = createContext(false);

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The field's name as the user sees it: its label, else its aria-label or placeholder. */
function fieldName(el: Field) {
  const label = el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.name;
  return label.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Our own wording for what is wrong with a field (the browser's bubbles are not shown). */
function problem(el: Field) {
  const v = el.validity;
  if (v.valueMissing) return el instanceof HTMLSelectElement ? "choose one" : "required";
  if (v.typeMismatch) return el.type === "email" ? "enter a valid email address" : "check the format";
  if (v.tooShort) return `at least ${(el as HTMLInputElement).minLength} characters`;
  if (v.tooLong) return `at most ${(el as HTMLInputElement).maxLength} characters`;
  if (v.rangeUnderflow) return `at least ${(el as HTMLInputElement).min}`;
  if (v.rangeOverflow) return `at most ${(el as HTMLInputElement).max}`;
  if (v.stepMismatch || v.badInput) return "enter a valid number";
  if (v.patternMismatch) return "check the format";
  return "check this value";
}

/**
 * A form that runs a Server Action and shows its error, message or generated link in place.
 * It submits through onSubmit, so what the user typed stays in the fields when the action fails.
 * Field checks (required, email, length, range) are done here, not by the browser: invalid fields turn red,
 * a message lists them by name, and the first one gets the focus.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnOk,
  onOk,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnOk?: boolean;
  /** Called once each time the action succeeds (e.g. a modal closes itself). */
  onOk?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const [invalid, setInvalid] = useState<{ name: string; why: string }[]>([]);
  const shown = useRef<ActionState>(state);

  useEffect(() => {
    if (state !== shown.current && state.ok) {
      if (resetOnOk) ref.current?.reset();
      onOk?.();
    }
    shown.current = state;
  }, [state, resetOnOk, onOk]);

  return (
    <form
      ref={ref}
      noValidate
      className={className}
      onInput={(e) => {
        // A corrected field loses its red mark and leaves the list at once.
        const el = e.target as Field;
        if (el.getAttribute?.("aria-invalid") === "true" && el.validity.valid) {
          el.removeAttribute("aria-invalid");
          setInvalid((list) => list.filter((x) => x.name !== fieldName(el)));
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        // A button marked formNoValidate (e.g. Return or Reject) skips the field checks; the server still checks.
        if (!submitter?.formNoValidate) {
          const fields = [...form.elements].filter(
            (el): el is Field => (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)
              && el.type !== "hidden" && !el.disabled,
          );
          fields.forEach((el) => el.removeAttribute("aria-invalid"));
          const bad = fields.filter((el) => !el.validity.valid);
          if (bad.length) {
            bad.forEach((el) => el.setAttribute("aria-invalid", "true"));
            const seen = new Set<string>();
            setInvalid(bad.map((el) => ({ name: fieldName(el), why: problem(el) })).filter((x) => !seen.has(x.name) && seen.add(x.name)));
            bad[0].focus();
            return;
          }
        }
        setInvalid([]);
        const data = new FormData(form, submitter);
        startTransition(() => formAction(data));
      }}
    >
      <Pending value={pending}>{children}</Pending>
      {invalid.length > 0 && (
        <div role="alert" className="mt-3 flex gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <b className="font-semibold">Please complete {invalid.length === 1 ? "this field" : "these fields"}:</b>
            <ul className="mt-0.5">
              {invalid.map((x) => <li key={x.name}>{x.name}: {x.why}</li>)}
            </ul>
          </div>
        </div>
      )}
      {state.error && !invalid.length && (
        <p role="alert" className="mt-3 flex gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      )}
      {state.ok && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.ok}</p>}
      {state.link && <LinkBox link={state.link} />}
    </form>
  );
}

export function Submit({ children, className = "btn btn-commit", name, value }: { children: ReactNode; className?: string; name?: string; value?: string }) {
  const pending = useContext(Pending);
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? "Working…" : children}
    </button>
  );
}

function LinkBox({ link }: { link: string }) {
  return (
    <div className="mt-3 rounded-md border border-brand/40 bg-brand-soft p-3">
      <p className="text-sm font-semibold text-slate-800">Link for the supplier. Copy it now: it is shown only once.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input readOnly value={link} className="input font-mono text-sm" aria-label="Supplier link" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(link)}>
          Copy
        </button>
      </div>
    </div>
  );
}
