import { checkApiKey, parseFilter, type ApiFilter } from "@/lib/api";
import { AppError } from "@/lib/util";

/** Shared by the /api/v1 routes: key check, filter parsing, JSON errors, no caching. */
export async function respond(req: Request, fn: (f: ApiFilter) => Promise<unknown>) {
  const headers = { "cache-control": "no-store" };
  if (!(await checkApiKey(req))) {
    return Response.json({ error: "Send a valid API key in the Authorization header (Bearer) or X-API-Key." }, { status: 401, headers });
  }
  try {
    return Response.json(await fn(parseFilter(new URL(req.url).searchParams)), { headers });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status ?? 400, headers });
    throw e;
  }
}
