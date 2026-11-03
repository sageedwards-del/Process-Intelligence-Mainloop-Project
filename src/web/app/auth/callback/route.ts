import type { NextRequest } from "next/server";
import { GET as confirm } from "../confirm/route";

/** Links sent before /auth/confirm existed still point here; handled the same way. */
export function GET(request: NextRequest) {
  return confirm(request);
}
