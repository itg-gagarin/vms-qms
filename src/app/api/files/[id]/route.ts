import { currentUser } from "@/platform/auth";
import { canRead } from "@/modules/ncf/visibility";
import { one, pool } from "@/platform/db";
import { readStoredFile } from "@/platform/files";
import type { NcfStatus } from "@/modules/ncf/labels";

// Internal users open evidence of NCFs they may read.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const fileId = Number((await params).id);
  const owner = await one<{ bu_id: number; status: NcfStatus }>(
    pool,
    `select n.bu_id, n.status from evidence e
     left join capa_response cr on cr.id = e.capa_response_id
     left join supplier_request r on r.id = cr.request_id
     join ncf n on n.id = coalesce(e.ncf_id, r.ncf_id)
     where e.file_id = $1 limit 1`,
    [fileId],
  );
  if (!owner || !canRead(user, owner.bu_id, owner.status)) return new Response("Not found.", { status: 404 });
  const f = await readStoredFile(pool, fileId);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(f.file_name)}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
