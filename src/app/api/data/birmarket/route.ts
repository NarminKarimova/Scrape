import { NextRequest, NextResponse } from "next/server";
import { loadBirmarketPage } from "@/lib/dashboard-data";
import { compactRows } from "@/lib/compact-dashboard-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 25_000;
const MAX_PAGE_SIZE = 100_000;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampPageSize(value: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, value));
}

export async function GET(request: NextRequest) {
  try {
    const cursor = parsePositiveInt(request.nextUrl.searchParams.get("cursor"), 0);
    const pageSize = clampPageSize(
      parsePositiveInt(request.nextUrl.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
    );
    const includeMeta = request.nextUrl.searchParams.get("includeMeta") !== "0";
    const compact = request.nextUrl.searchParams.get("compact") === "1";
    const page = await loadBirmarketPage(cursor, pageSize, includeMeta || compact);

    return NextResponse.json(
      {
        project: "Birmarket",
        rows: compact ? compactRows("Birmarket", page.rows, page.meta) : page.rows,
        ...(compact ? { compact: true } : {}),
        page: {
          cursor: page.cursor,
          nextCursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
          total: page.total,
          pageSize,
        },
        ...(includeMeta && page.meta ? { meta: page.meta } : {}),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load Birmarket data", error);
    return NextResponse.json(
      { error: "Failed to load Birmarket data" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
