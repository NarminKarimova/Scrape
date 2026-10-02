import { NextResponse } from "next/server";
import { loadDashboardSummary } from "@/lib/dashboard-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const summary = await loadDashboardSummary("turbo");
  if (!summary) {
    return NextResponse.json(
      { error: "Turbo summary not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
