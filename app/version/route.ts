import { NextResponse } from "next/server";
import { BUILD } from "@/lib/version";

/** Public build identity of the deployed web app. */
export function GET() {
  return NextResponse.json({ app: "nynz-web", ...BUILD }, { headers: { "cache-control": "no-store" } });
}
