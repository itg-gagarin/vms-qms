import Link from "next/link";
import { Shell } from "@/components/ui";

// Shown when the NCF does not exist, or is at a stage your department does not work with.
export default function NcfNotFound() {
  return (
    <Shell>
      <div className="card flex flex-col gap-3 p-8">
        <h1 className="text-2xl font-bold">This NCF is not open to you</h1>
        <p className="text-slate-700">
          Either the number does not exist, or the NCF is at a stage your department does not work with. QC sees drafts, pending and
          closed NCFs; approvers see pending, approved and closed; Purchasing sees them from approval to closure.
        </p>
        <p><Link href="/ncf" className="btn h-10 no-underline">Back to the NCF list</Link></p>
      </div>
    </Shell>
  );
}
