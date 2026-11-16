import { apiResponsiveness } from "@/modules/ncf/api";
import { respond } from "../_respond";

// GET /api/v1/responsiveness?from=YYYY-MM-DD&to=YYYY-MM-DD&supplier=<vendor code>&bu=<unit code>
export async function GET(req: Request) {
  return respond(req, apiResponsiveness);
}
