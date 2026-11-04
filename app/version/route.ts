import { NextResponse } from "next/server";
import { BUILD } from "@/lib/version";

/** Public release number only; internal deployment identity is private. */
export function GET() {
  return NextResponse.json({ app: "nynz-web", ...BUILD }, { headers: { "cache-control": "no-store" } });
}
