import { parquetRead } from "hyparquet";
import {
  readJsonFile,
  resolveDataBackend,
  resolveParquetBackend,
  type DataBackend,
} from "@/lib/data-backend";

export type ProjectKey = "Bina.az" | "Markets" | "Turbo.az";

export type BinaRow = {
  period: string;
  operationType: "Sale" | "Rent";
  region: string;
  category: string;
  rooms: number | null;
  price: number;
  area: number;
  pricePerM2: number;
};

export type MarketsRow = {
  period: string;
  source: string;
  category: string;
  brand: string;
  price: number;
};

export type TurboRow = {
  period: string;
  brand: string;
  price: number;
  year: number | null;
  mileage: number | null;
  fuelType: string;
  bodyType: string;
  transmission: string;
};

const cache = new Map<string, { data: unknown; timestamp: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minute cache

type DataManifest = {
  bina: string[];
  markets: string[];
  turbo: string[];
};

function getCached<T>(key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return cached.data as T;
}

function setCached(key: string, data: unknown) {
  cache.set(key, { data, timestamp: Date.now() });
}

function withInFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = loader().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise as Promise<unknown>);
  return promise;
}

function extractPeriodFromName(name: string): string {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const lowerName = name.toLowerCase();
  const suffix =
    /[-_](q1|h1)(?=[._-]|$)/i.test(lowerName)
      ? " (H1)"
      : /[-_](q2|h2)(?=[._-]|$)/i.test(lowerName)
        ? " (H2)"
        : "";
  const yyyymm = name.match(/(\d{6})/);
  if (yyyymm) {
    const month = parseInt(yyyymm[1].slice(4), 10);
    const monthName = monthNames[month - 1] || "Unknown";
    return `${monthName}${suffix}`;
  }
  const yyyyMm = name.match(/(\d{4}-\d{2})/);
  if (yyyyMm) {
    const month = parseInt(yyyyMm[1].split("-")[1], 10);
    const monthName = monthNames[month - 1] || "Unknown";
    return `${monthName}${suffix}`;
  }
  return "Unknown";
}

function basename(pathLike: string): string {
  const normalized = pathLike.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.at(-1) ?? pathLike;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeSource(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("bazar")) return "BazarStore";
  if (s.includes("araz")) return "Araz";
  if (s.includes("neptun")) return "Neptun";
  return raw;
}

type ChunkRef = { key: string; count: number };

type ProjectIndex = {
  total: number;
  chunks: ChunkRef[];
  meta: Record<string, unknown>;
};

export type PageResult<T> = {
  rows: T[];
  total: number;
  cursor: number;
  nextCursor: number | null;
  meta?: Record<string, unknown>;
};

async function readParquetRowsFromFile(
  backend: DataBackend,
  relativePath: string,
): Promise<Record<string, unknown>[]> {
  const buffer = await backend.readFileBuffer(relativePath);
  return new Promise((resolve, reject) => {
    parquetRead({
      file: buffer,
      rowFormat: "object",
      onComplete: (rows) => resolve(rows as unknown as Record<string, unknown>[]),
    }).catch(reject);
  });
}

function dedupeManifestPaths(paths: string[]): string[] {
  const dedupedByBasename = new Map<string, string>();

  for (const rawPath of paths) {
    const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const key = basename(normalizedPath).toLowerCase();
    const existing = dedupedByBasename.get(key);

    if (!existing) {
      dedupedByBasename.set(key, normalizedPath);
      continue;
    }

    // Prefer canonical files under nested /data paths when both variants exist.
    if (normalizedPath.includes("/data/")) {
      dedupedByBasename.set(key, normalizedPath);
    }
  }

  return [...dedupedByBasename.values()];
}

async function loadManifest(backend: DataBackend): Promise<DataManifest> {
  const key = `manifest:${backend.id}`;
  const cached = getCached<DataManifest>(key);
  if (cached) return cached;

  return withInFlight(key, async () => {
    const manifest: DataManifest = {
      bina: dedupeManifestPaths(
        (await backend.listParquetPaths("bina_az/data")).filter((filePath) =>
          basename(filePath).toLowerCase().includes("bina_"),
        ),
      ),
      markets: dedupeManifestPaths(await backend.listParquetPaths("markets/data")),
      turbo: dedupeManifestPaths(await backend.listParquetPaths("turbo_az/data")),
    };

    setCached(key, manifest);
    return manifest;
  });
}

async function loadProjectIndex(backend: DataBackend, project: string): Promise<ProjectIndex | null> {
  const key = `index:${backend.id}:${project}`;
  const cached = getCached<ProjectIndex>(key);
  if (cached) return cached;

  return withInFlight(key, async () => {
    const index = await readJsonFile<ProjectIndex>(backend, `${project}/index.json`);
    if (index) setCached(key, index);
    return index;
  });
}

async function loadRowsFromIndex<T>(
  backend: DataBackend,
  index: ProjectIndex,
  cursor: number,
  pageSize: number,
): Promise<T[]> {
  if (cursor >= index.total || pageSize <= 0) return [];

  const rows: T[] = [];
  let remaining = pageSize;
  let globalOffset = 0;

  for (const chunk of index.chunks) {
    const chunkStart = globalOffset;
    const chunkEnd = globalOffset + chunk.count;
    globalOffset = chunkEnd;

    if (cursor >= chunkEnd) continue;
    if (rows.length >= pageSize) break;

    const chunkRows = await readJsonFile<T[]>(backend, chunk.key);
    if (!chunkRows) {
      throw new Error(`Chunk not found: ${chunk.key}`);
    }

    const localStart = Math.max(0, cursor - chunkStart);
    const take = Math.min(remaining, chunkRows.length - localStart);
    rows.push(...chunkRows.slice(localStart, localStart + take));
    remaining -= take;
  }

  return rows;
}

async function loadProjectPage<T>(
  project: string,
  cursor: number,
  pageSize: number,
  includeMeta: boolean,
  fullLoader: () => Promise<T[]>,
  buildMeta: (rows: T[]) => Record<string, unknown>,
): Promise<PageResult<T>> {
  const backend = await resolveDataBackend();
  const index = await loadProjectIndex(backend, project);

  if (index) {
    const safeCursor = Math.min(cursor, index.total);
    const rows = await loadRowsFromIndex<T>(backend, index, safeCursor, pageSize);
    const sliceEnd = safeCursor + rows.length;
    return {
      rows,
      total: index.total,
      cursor: safeCursor,
      nextCursor: sliceEnd < index.total ? sliceEnd : null,
      meta: includeMeta ? index.meta : undefined,
    };
  }

  const allRows = await fullLoader();
  const safeCursor = Math.min(cursor, allRows.length);
  const pageRows = allRows.slice(safeCursor, safeCursor + pageSize);
  const sliceEnd = safeCursor + pageRows.length;

  return {
    rows: pageRows,
    total: allRows.length,
    cursor: safeCursor,
    nextCursor: sliceEnd < allRows.length ? sliceEnd : null,
    meta: includeMeta ? buildMeta(allRows) : undefined,
  };
}

export async function loadBinaPage(
  cursor: number,
  pageSize: number,
  includeMeta: boolean,
): Promise<PageResult<BinaRow>> {
  return loadProjectPage("bina", cursor, pageSize, includeMeta, loadBinaRows, (rows) => ({
    periods: sortedPeriods(rows.map((r) => r.period)),
    operations: ["Sale", "Rent"],
    regions: [...new Set(rows.map((r) => r.region))].sort(),
    categories: [...new Set(rows.map((r) => r.category))].sort(),
    rooms: [...new Set(rows.map((r) => r.rooms).filter((x) => x !== null))].sort(
      (a, b) => Number(a) - Number(b),
    ),
  }));
}

export async function loadMarketsPage(
  cursor: number,
  pageSize: number,
  includeMeta: boolean,
): Promise<PageResult<MarketsRow>> {
  return loadProjectPage("markets", cursor, pageSize, includeMeta, loadMarketsRows, (rows) => ({
    periods: sortedPeriods(rows.map((r) => r.period)),
    sources: [...new Set(rows.map((r) => r.source))].sort(),
    categories: [...new Set(rows.map((r) => r.category))].sort(),
    brands: [...new Set(rows.map((r) => r.brand))].sort(),
  }));
}

export async function loadTurboPage(
  cursor: number,
  pageSize: number,
  includeMeta: boolean,
): Promise<PageResult<TurboRow>> {
  return loadProjectPage("turbo", cursor, pageSize, includeMeta, loadTurboRows, (rows) => ({
    periods: sortedPeriods(rows.map((r) => r.period)),
    brands: [...new Set(rows.map((r) => r.brand))].sort(),
    fuelTypes: [...new Set(rows.map((r) => r.fuelType))].sort(),
    bodyTypes: [...new Set(rows.map((r) => r.bodyType))].sort(),
    transmissions: [...new Set(rows.map((r) => r.transmission))].sort(),
  }));
}

export async function loadBinaRows(): Promise<BinaRow[]> {
  const backend = await resolveParquetBackend();
  const key = `bina:${backend.id}`;
  const cached = getCached<BinaRow[]>(key);
  if (cached) return cached;

  return withInFlight(key, async () => {
    const manifest = await loadManifest(backend);
    const files = dedupeManifestPaths(manifest.bina);
    const rows: BinaRow[] = [];

    for (const relativePath of files) {
      const fileName = basename(relativePath);
      const period = extractPeriodFromName(fileName);
      const operationType: "Sale" | "Rent" = relativePath.toLowerCase().includes("rent")
        ? "Rent"
        : "Sale";

      const rawRows = await readParquetRowsFromFile(backend, relativePath);

      for (const row of rawRows) {
        if (toStr(row.city_name) !== "Bakı") continue;

        const price = toNumber(row.price_value);
        const areaRaw = toNumber(row.area_value);
        if (price === null || areaRaw === null || areaRaw <= 0) continue;

        const area = toStr(row.area_units).toLowerCase() === "sot"
          ? areaRaw * 100
          : areaRaw;
        if (area <= 0) continue;

        const pricePerM2 = price / area;
        if (!Number.isFinite(pricePerM2) || pricePerM2 <= 0) continue;

        const roomsVal = toNumber(row.rooms);
        const rooms = roomsVal && roomsVal > 0 ? Math.round(roomsVal) : null;

        rows.push({
          period,
          operationType,
          region: toStr(row.location_name) || "Naməlum",
          category: toStr(row.category) || "Unknown",
          rooms,
          price,
          area,
          pricePerM2,
        });
      }
    }

    setCached(key, rows);
    return rows;
  });
}

export async function loadMarketsRows(): Promise<MarketsRow[]> {
  const backend = await resolveParquetBackend();
  const key = `markets:${backend.id}`;
  const cached = getCached<MarketsRow[]>(key);
  if (cached) return cached;

  return withInFlight(key, async () => {
    const manifest = await loadManifest(backend);
    const files = dedupeManifestPaths(manifest.markets);
    const rows: MarketsRow[] = [];

    for (const relativePath of files) {
      const fileName = basename(relativePath);
      const period = extractPeriodFromName(fileName);
      const srcFromFile = normalizeSource(fileName.split("_")[0]);

      const rawRows = await readParquetRowsFromFile(backend, relativePath);

      for (const row of rawRows) {
        const price = toNumber(row.price);
        if (price === null || price <= 0) continue;

        const source = normalizeSource(toStr(row.source) || srcFromFile);
        rows.push({
          period,
          source,
          category: toStr(row.category) || "Unknown",
          brand: toStr(row.brand) || "Unknown",
          price,
        });
      }
    }

    setCached(key, rows);
    return rows;
  });
}

export async function loadTurboRows(): Promise<TurboRow[]> {
  const backend = await resolveParquetBackend();
  const key = `turbo:${backend.id}`;
  const cached = getCached<TurboRow[]>(key);
  if (cached) return cached;

  return withInFlight(key, async () => {
    const manifest = await loadManifest(backend);
    const files = dedupeManifestPaths(manifest.turbo);
    const rows: TurboRow[] = [];

    for (const relativePath of files) {
      const fileName = basename(relativePath);
      const period = extractPeriodFromName(fileName);

      const rawRows = await readParquetRowsFromFile(backend, relativePath);

      for (const row of rawRows) {
        const price = toNumber(row.price);
        if (price === null || price <= 0) continue;

        const yearRaw = toNumber(row.year);
        const mileageRaw = toNumber(row.mileage);
        const detailEngine = toStr(row.detail_engine);
        const detailBodyType = toStr(row.detail_body_type);
        const transmission = toStr(row.detail_transmission);

        const fuelType = detailEngine.includes("/")
          ? detailEngine.split("/").at(-1)?.trim() || "Unknown"
          : detailEngine || "Unknown";

        rows.push({
          period,
          brand: toStr(row.brand) || "Unknown",
          price,
          year: yearRaw === null ? null : Math.round(yearRaw),
          mileage: mileageRaw,
          fuelType,
          bodyType: detailBodyType || "Unknown",
          transmission: transmission || "Unknown",
        });
      }
    }

    setCached(key, rows);
    return rows;
  });
}

export function sortedPeriods(periods: string[]): string[] {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const unique = Array.from(new Set(periods));

  function parseKey(p: string) {
    const part = /q1|h1|\(H1\)/i.test(p) ? 1 : /q2|h2|\(H2\)/i.test(p) ? 2 : 0;
    const yymm = p.match(/(\d{4})-?(\d{2})/);
    if (yymm) {
      const y = Number(yymm[1]);
      const m = Number(yymm[2]);
      return { y, m, part };
    }

    const short = String(p).trim();
    const monthMatch = monthNames.findIndex((n) => short.startsWith(n));
    const m = monthMatch >= 0 ? monthMatch + 1 : 999;
    const y = 0;
    return { y, m, part };
  }

  return unique.sort((a, b) => {
    const ka = parseKey(a);
    const kb = parseKey(b);
    if (ka.y !== kb.y) return ka.y - kb.y;
    if (ka.m !== kb.m) return ka.m - kb.m;
    if (ka.part !== kb.part) return ka.part - kb.part;
    return a.localeCompare(b);
  });
}
