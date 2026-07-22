import {
  loadBinaPage,
  loadMarketsPage,
  loadTurboPage,
  type BinaRow,
  type MarketsRow,
  type ProjectKey,
  type TurboRow,
} from "@/lib/dashboard-data";

type AnyRow = BinaRow | MarketsRow | TurboRow;

type ToolContext = {
  project?: ProjectKey;
  filters?: Record<string, unknown>;
};

type ToolArgs = {
  dimension?: string;
  limit?: number;
  periodA?: string;
  periodB?: string;
  query?: string;
  key?: string;
  filters?: Record<string, unknown>;
  scope?: "current" | "all" | "custom";
};

const rowCache = new Map<ProjectKey, { rows: AnyRow[]; timestamp: number }>();
const rowInFlight = new Map<ProjectKey, Promise<AnyRow[]>>();
const ROW_CACHE_TTL = 5 * 60 * 1000;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function periodKey(period: string) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const part = /q1|h1|\(H1\)/i.test(period) ? 1 : /q2|h2|\(H2\)/i.test(period) ? 2 : 0;
  const yymm = period.match(/(\d{4})-?(\d{2})/);
  if (yymm) {
    return { year: Number(yymm[1]), month: Number(yymm[2]), part };
  }
  const month = monthNames.findIndex((name) => period.startsWith(name)) + 1;
  return { year: 0, month: month || 999, part };
}

function periodCompare(a: string, b: string): number {
  const left = periodKey(a);
  const right = periodKey(b);
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  if (left.part !== right.part) return left.part - right.part;
  return a.localeCompare(b);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function numberRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const a = Number(value[0]);
  const b = Number(value[1]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function inRange(value: number | null, range: [number, number] | null): boolean {
  if (!range || value == null) return true;
  return value >= range[0] && value <= range[1];
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("az-AZ")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c");
}

async function loadAllPages<T>(
  loader: (cursor: number, pageSize: number, includeMeta: boolean) => Promise<{
    rows: T[];
    nextCursor: number | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 25_000;
  let cursor = 0;

  while (true) {
    const page = await loader(cursor, pageSize, false);
    rows.push(...page.rows);
    if (page.nextCursor === null) return rows;
    cursor = page.nextCursor;
  }
}

async function loadRows(project: ProjectKey): Promise<AnyRow[]> {
  const cached = rowCache.get(project);
  if (cached && Date.now() - cached.timestamp <= ROW_CACHE_TTL) return cached.rows;
  if (cached) rowCache.delete(project);

  const existing = rowInFlight.get(project);
  if (existing) return existing;

  const promise = (async (): Promise<AnyRow[]> => {
    if (project === "Bina.az") return loadAllPages<BinaRow>(loadBinaPage);
    if (project === "Markets") return loadAllPages<MarketsRow>(loadMarketsPage);
    return loadAllPages<TurboRow>(loadTurboPage);
  })();

  rowInFlight.set(project, promise);
  try {
    const rows = await promise;
    rowCache.set(project, { rows, timestamp: Date.now() });
    return rows;
  } finally {
    rowInFlight.delete(project);
  }
}

function metric(project: ProjectKey, row: AnyRow, operationType?: string): number {
  if (project === "Bina.az") {
    const bina = row as BinaRow;
    return operationType === "Rent" ? bina.price : bina.pricePerM2;
  }
  return (row as MarketsRow | TurboRow).price;
}

function rowDimension(project: ProjectKey, row: AnyRow, dimension: string): string {
  if (project === "Bina.az") {
    const bina = row as BinaRow;
    if (dimension === "rooms") return bina.rooms == null ? "Unknown" : bina.rooms >= 5 ? "5+" : String(bina.rooms);
    if (dimension === "category") return bina.category;
    return bina.region;
  }

  if (project === "Markets") {
    const market = row as MarketsRow;
    if (dimension === "source") return market.source;
    if (dimension === "brand") return market.brand;
    return market.category;
  }

  const turbo = row as TurboRow;
  if (dimension === "fuelType") return turbo.fuelType;
  if (dimension === "bodyType") return turbo.bodyType;
  if (dimension === "transmission") return turbo.transmission;
  return turbo.brand;
}

function defaultDimension(project: ProjectKey): string {
  if (project === "Bina.az") return "region";
  if (project === "Markets") return "category";
  return "brand";
}

function baseFiltersForScope(project: ProjectKey, context: ToolContext, args: ToolArgs): Record<string, unknown> {
  if (args.scope === "all") {
    return project === "Bina.az"
      ? { operationType: context.filters?.operationType ?? "Sale" }
      : {};
  }
  if (args.scope === "custom") {
    return project === "Bina.az"
      ? { operationType: context.filters?.operationType ?? "Sale" }
      : {};
  }
  return context.filters ?? {};
}

function toolContextWithOverrides(project: ProjectKey, context: ToolContext, args: ToolArgs): ToolContext {
  return {
    ...context,
    filters: {
      ...baseFiltersForScope(project, context, args),
      ...(args.filters ?? {}),
    },
  };
}

function filterRows(project: ProjectKey, rows: AnyRow[], context: ToolContext): AnyRow[] {
  const filters = context.filters ?? {};
  const periods = new Set(stringArray(filters.periods));
  const hasPeriods = periods.size > 0;

  if (project === "Bina.az") {
    const operationType = String(filters.operationType ?? "Sale");
    const categories = new Set(stringArray(filters.categories));
    const rooms = new Set(stringArray(filters.rooms));
    const selectedRegions = new Set(stringArray(filters.selectedRegions));
    const priceRange = numberRange(filters.priceRange);
    const areaRange = numberRange(filters.areaRange);
    const unitPriceRange = numberRange(filters.unitPriceRange);

    return (rows as BinaRow[]).filter((row) => {
      const room = row.rooms == null ? "" : row.rooms >= 5 ? "5+" : String(row.rooms);
      return (
        (!hasPeriods || periods.has(row.period)) &&
        row.operationType === operationType &&
        (categories.size === 0 || categories.has(row.category)) &&
        (rooms.size === 0 || rooms.has(room)) &&
        (selectedRegions.size === 0 || selectedRegions.has(row.region)) &&
        inRange(row.price, priceRange) &&
        inRange(row.area, areaRange) &&
        (operationType === "Rent" || inRange(row.pricePerM2, unitPriceRange))
      );
    });
  }

  if (project === "Markets") {
    const sources = new Set(stringArray(filters.sources));
    const categories = new Set(stringArray(filters.categories));
    const brands = new Set(stringArray(filters.brands));
    const priceRange = numberRange(filters.priceRange);

    return (rows as MarketsRow[]).filter((row) => (
      (!hasPeriods || periods.has(row.period)) &&
      (sources.size === 0 || sources.has(row.source)) &&
      (categories.size === 0 || categories.has(row.category)) &&
      (brands.size === 0 || brands.has(row.brand)) &&
      inRange(row.price, priceRange)
    ));
  }

  const brands = new Set(stringArray(filters.selectedBrands));
  const fuelTypes = new Set(stringArray(filters.fuelTypes));
  const bodyTypes = new Set(stringArray(filters.bodyTypes));
  const transmissions = new Set(stringArray(filters.transmissions));
  const priceRange = numberRange(filters.priceRange);
  const yearRange = numberRange(filters.yearRange);
  const mileageRange = numberRange(filters.mileageRange);

  return (rows as TurboRow[]).filter((row) => (
    (!hasPeriods || periods.has(row.period)) &&
    (brands.size === 0 || brands.has(row.brand)) &&
    (fuelTypes.size === 0 || fuelTypes.has(row.fuelType)) &&
    (bodyTypes.size === 0 || bodyTypes.has(row.bodyType)) &&
    (transmissions.size === 0 || transmissions.has(row.transmission)) &&
    inRange(row.price, priceRange) &&
    inRange(row.year, yearRange) &&
    inRange(row.mileage, mileageRange)
  ));
}

function summarize(project: ProjectKey, rows: AnyRow[], context: ToolContext) {
  const operationType = String(context.filters?.operationType ?? "Sale");
  const byPeriod = new Map<string, number[]>();
  for (const row of rows) {
    const values = byPeriod.get(row.period) ?? [];
    values.push(metric(project, row, operationType));
    byPeriod.set(row.period, values);
  }

  const trend = [...byPeriod.entries()]
    .map(([period, values]) => ({
      period,
      count: values.length,
      median: Number(median(values).toFixed(project === "Markets" ? 2 : 0)),
    }))
    .sort((a, b) => periodCompare(a.period, b.period));

  return {
    rowCount: rows.length,
    metric: project === "Bina.az" && operationType !== "Rent" ? "pricePerM2" : "price",
    latest: trend.at(-1) ?? null,
    previous: trend.at(-2) ?? null,
    trend,
  };
}

function segmentBreakdown(project: ProjectKey, rows: AnyRow[], context: ToolContext, args: ToolArgs) {
  const dimension = args.dimension || defaultDimension(project);
  const limit = Math.min(Math.max(Number(args.limit ?? 12), 1), 30);
  const operationType = String(context.filters?.operationType ?? "Sale");
  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    const key = rowDimension(project, row, dimension);
    const values = buckets.get(key) ?? [];
    values.push(metric(project, row, operationType));
    buckets.set(key, values);
  }

  return {
    dimension,
    rows: [...buckets.entries()]
      .map(([key, values]) => ({
        key,
        count: values.length,
        median: Number(median(values).toFixed(project === "Markets" ? 2 : 0)),
      }))
      .filter((point) => point.count >= 5)
      .sort((a, b) => b.median - a.median)
      .slice(0, limit),
  };
}

function dimensionsForProject(project: ProjectKey): string[] {
  if (project === "Bina.az") return ["region", "category", "rooms"];
  if (project === "Markets") return ["source", "category", "brand"];
  return ["brand", "fuelType", "bodyType", "transmission"];
}

function findMatchingValues(project: ProjectKey, rows: AnyRow[], args: ToolArgs) {
  const query = normalizeSearch(String(args.query ?? "").trim());
  const tokens = query
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
  const dimensions = dimensionsForProject(project);
  const counts = new Map<string, { dimension: string; value: string; count: number }>();

  for (const row of rows) {
    for (const dimension of dimensions) {
      const value = rowDimension(project, row, dimension);
      const normalizedValue = normalizeSearch(value);
      const matches =
        !query ||
        normalizedValue.includes(query) ||
        tokens.some((token) => normalizedValue.includes(token));
      if (matches) {
        const id = `${dimension}\u0000${value}`;
        const existing = counts.get(id) ?? { dimension, value, count: 0 };
        existing.count += 1;
        counts.set(id, existing);
      }
    }
  }

  return {
    query,
    matches: [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit),
  };
}

function compareSegment(project: ProjectKey, rows: AnyRow[], context: ToolContext, args: ToolArgs) {
  const dimension = args.dimension || defaultDimension(project);
  const key = String(args.key ?? "").trim();
  const operationType = String(context.filters?.operationType ?? "Sale");
  const segmentRows = key
    ? rows.filter((row) => normalizeSearch(rowDimension(project, row, dimension)) === normalizeSearch(key))
    : [];

  const marketValues = rows.map((row) => metric(project, row, operationType));
  const segmentValues = segmentRows.map((row) => metric(project, row, operationType));
  const marketMedian = median(marketValues);
  const segmentMedian = median(segmentValues);
  const premiumPct = marketMedian ? ((segmentMedian - marketMedian) / marketMedian) * 100 : null;

  return {
    dimension,
    key,
    market: {
      count: rows.length,
      median: Number(marketMedian.toFixed(project === "Markets" ? 2 : 0)),
    },
    segment: {
      count: segmentRows.length,
      median: Number(segmentMedian.toFixed(project === "Markets" ? 2 : 0)),
    },
    premiumPct,
    segmentTrend: summarize(project, segmentRows, context),
  };
}

function analyzeUserQuery(project: ProjectKey, rows: AnyRow[], context: ToolContext, args: ToolArgs) {
  const matches = findMatchingValues(project, rows, {
    query: args.query,
    limit: 10,
  }).matches;
  const bestMatch = matches[0];
  return {
    query: args.query ?? "",
    matches,
    bestSegmentComparison: bestMatch
      ? compareSegment(project, rows, context, {
          dimension: bestMatch.dimension,
          key: bestMatch.value,
        })
      : null,
  };
}

function comparePeriods(project: ProjectKey, rows: AnyRow[], context: ToolContext, args: ToolArgs) {
  const summary = summarize(project, rows, context);
  const periods = summary.trend.map((point) => point.period);
  const periodA = args.periodA || periods.at(-2);
  const periodB = args.periodB || periods.at(-1);
  const a = summary.trend.find((point) => point.period === periodA);
  const b = summary.trend.find((point) => point.period === periodB);
  const changePct = a && b && a.median ? ((b.median - a.median) / a.median) * 100 : null;

  return { periodA, periodB, from: a ?? null, to: b ?? null, changePct };
}

export async function runChatAnalysisTool(
  name: string,
  args: ToolArgs,
  context: ToolContext,
) {
  const project = context.project;
  if (!project) return { error: "No project in context." };

  const effectiveContext = toolContextWithOverrides(project, context, args);
  const allRows = await loadRows(project);
  const rows = filterRows(project, allRows, effectiveContext);
  if (name === "summarize_current_view") return summarize(project, rows, effectiveContext);
  if (name === "summarize_filtered_view") return summarize(project, rows, effectiveContext);
  if (name === "get_segment_breakdown") return segmentBreakdown(project, rows, effectiveContext, args);
  if (name === "compare_periods") return comparePeriods(project, rows, effectiveContext, args);
  if (name === "find_matching_values") return findMatchingValues(project, allRows, args);
  if (name === "compare_segment") return compareSegment(project, rows, effectiveContext, args);
  if (name === "analyze_user_query") return analyzeUserQuery(project, rows, effectiveContext, args);

  return { error: `Unknown tool: ${name}` };
}
