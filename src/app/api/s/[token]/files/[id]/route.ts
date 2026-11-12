import { pool } from "@/lib/db";
import { readStoredFile } from "@/lib/files";
import { supplierFileAllowed } from "@/lib/supplier";
import { AppError } from "@/lib/util";

// The supplier opens evidence of its own NCF through its token.
export async function GET(_: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  try {
    await supplierFileAllowed(token, Number(id));
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
  const f = await readStoredFile(pool, Number(id));
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(f.file_name)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
