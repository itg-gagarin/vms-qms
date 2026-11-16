import { apiNcfs } from "@/lib/api";
import { respond } from "../_respond";

// GET /api/v1/ncfs?from=YYYY-MM-DD&to=YYYY-MM-DD&status=&supplier=<vendor code>&bu=<unit code>&page=1&size=100
export async function GET(req: Request) {
  return respond(req, apiNcfs);
}
