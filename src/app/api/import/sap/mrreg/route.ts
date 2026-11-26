import { importSapMrreg } from "@/modules/ncf/sap-feed";
import { checkApiKey } from "@/platform/api-keys";
import { AppError } from "@/platform/util";

/**
 * The SAP feed (n8n): POST { window?: { from, to }, rows: [...] } with an Import API key. Rows are the columns of
 * integrations/sap/mrreg_and_pos_sync.sql. Returns what was added, updated and skipped. Safe to send again.
 */
export async function POST(req: Request) {
  const headers = { "cache-control": "no-store" };
  const keyId = await checkApiKey(req, "import");
  if (!keyId) {
    return Response.json({ error: "Send a valid Import API key in X-API-Key (or Authorization: Bearer). Read keys cannot import." }, { status: 401, headers });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "The body is not JSON." }, { status: 400, headers });
  }
  try {
    return Response.json(await importSapMrreg(keyId, body), { headers });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status ?? 400, headers });
    throw e;
  }
}
