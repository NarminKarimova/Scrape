import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parquetRead } from "../node_modules/hyparquet/src/node.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "processed");
const CHUNK_SIZE = 25_000;

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function extractPeriodFromName(name) {
  const lowerName = name.toLowerCase();
  const suffix = /[-_](q1|h1)(?=[._-]|$)/i.test(lowerName)
    ? " (H1)"
    : /[-_](q2|h2)(?=[._-]|$)/i.test(lowerName)
      ? " (H2)"
      : "";
  const yyyymm = name.match(/(\d{6})/);
  if (yyyymm) {
    const month = parseInt(yyyymm[1].slice(4), 10);
    return `${monthNames[month - 1] || "Unknown"}${suffix}`;
  }
  const yyyyMm = name.match(/(\d{4}-\d{2})/);
  if (yyyyMm) {
    const month = parseInt(yyyyMm[1].split("-")[1], 10);
    return `${monthNames[month - 1] || "Unknown"}${suffix}`;
  }
  return "Unknown";
}

function basename(filePath) {
  return filePath.replace(/\\/g, "/").split("/").at(-1) ?? filePath;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toStr(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeSource(raw) {
  const s = raw.toLowerCase();
  if (s.includes("bazar")) return "BazarStore";
  if (s.includes("araz")) return "Araz";
  if (s.includes("neptun")) return "Neptun";
  return raw;
}

function sortedPeriods(periods) {
  const unique = Array.from(new Set(periods));
  function parseKey(p) {
    const part = /q1|h1|\(H1\)/i.test(p) ? 1 : /q2|h2|\(H2\)/i.test(p) ? 2 : 0;
    const yymm = p.match(/(\d{4})-?(\d{2})/);
    if (yymm) return { y: Number(yymm[1]), m: Number(yymm[2]), part };
    const monthMatch = monthNames.findIndex((n) => String(p).trim().startsWith(n));
    return { y: 0, m: monthMatch >= 0 ? monthMatch + 1 : 999, part };
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

function walkParquetFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) files.push(...walkParquetFiles(fullPath));
    else if (entry.toLowerCase().endsWith(".parquet")) files.push(fullPath);
  }
  return files;
}

async function readParquetRows(relativePath) {
  const filePath = path.join(DATA_ROOT, relativePath);
  const buffer = readFileSync(filePath);
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => {
    parquetRead({
      file: ab,
      rowFormat: "object",
      onComplete: (rows) => resolve(rows),
    }).catch(reject);
  });
}

function dedupeManifestPaths(paths) {
  const deduped = new Map();
  for (const rawPath of paths) {
    const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const key = basename(normalizedPath).toLowerCase();
    const existing = deduped.get(key);
    if (!existing || normalizedPath.includes("/data/")) {
      deduped.set(key, normalizedPath);
    }
  }
  return [...deduped.values()];
}

async function loadBinaRows() {
  const files = dedupeManifestPaths(
    walkParquetFiles(path.join(DATA_ROOT, "bina_az/data"))
      .map((f) => path.relative(DATA_ROOT, f).replace(/\\/g, "/"))
      .filter((f) => basename(f).toLowerCase().includes("bina_")),
  );
  const rows = [];
  for (const relativePath of files) {
    const fileName = basename(relativePath);
    const period = extractPeriodFromName(fileName);
    const operationType = relativePath.toLowerCase().includes("rent") ? "Rent" : "Sale";
    const rawRows = await readParquetRows(relativePath);
    for (const row of rawRows) {
      if (toStr(row.city_name) !== "Bakı") continue;
      const price = toNumber(row.price_value);
      const areaRaw = toNumber(row.area_value);
      if (price === null || areaRaw === null || areaRaw <= 0) continue;
      const area = toStr(row.area_units).toLowerCase() === "sot" ? areaRaw * 100 : areaRaw;
      if (area <= 0) continue;
      const pricePerM2 = price / area;
      if (!Number.isFinite(pricePerM2) || pricePerM2 <= 0) continue;
      const roomsVal = toNumber(row.rooms);
      rows.push({
        period,
        operationType,
        region: toStr(row.location_name) || "Naməlum",
        category: toStr(row.category) || "Unknown",
        rooms: roomsVal && roomsVal > 0 ? Math.round(roomsVal) : null,
        price,
        area,
        pricePerM2,
      });
    }
  }
  return rows;
}

async function loadMarketsRows() {
  const files = dedupeManifestPaths(
    walkParquetFiles(path.join(DATA_ROOT, "markets/data")).map((f) =>
      path.relative(DATA_ROOT, f).replace(/\\/g, "/"),
    ),
  );
  const rows = [];
  for (const relativePath of files) {
    const fileName = basename(relativePath);
    const period = extractPeriodFromName(fileName);
    const srcFromFile = normalizeSource(fileName.split("_")[0]);
    const rawRows = await readParquetRows(relativePath);
    for (const row of rawRows) {
      const price = toNumber(row.price);
      if (price === null || price <= 0) continue;
      rows.push({
        period,
        source: normalizeSource(toStr(row.source) || srcFromFile),
        category: toStr(row.category) || "Unknown",
        brand: toStr(row.brand) || "Unknown",
        price,
      });
    }
  }
  return rows;
}

async function loadTurboRows() {
  const files = dedupeManifestPaths(
    walkParquetFiles(path.join(DATA_ROOT, "turbo_az/data")).map((f) =>
      path.relative(DATA_ROOT, f).replace(/\\/g, "/"),
    ),
  );
  const rows = [];
  for (const relativePath of files) {
    const fileName = basename(relativePath);
    const period = extractPeriodFromName(fileName);
    const rawRows = await readParquetRows(relativePath);
    for (const row of rawRows) {
      const price = toNumber(row.price);
      if (price === null || price <= 0) continue;
      const detailEngine = toStr(row.detail_engine);
      rows.push({
        period,
        brand: toStr(row.brand) || "Unknown",
        price,
        year: toNumber(row.year) === null ? null : Math.round(toNumber(row.year)),
        mileage: toNumber(row.mileage),
        fuelType: detailEngine.includes("/")
          ? detailEngine.split("/").at(-1)?.trim() || "Unknown"
          : detailEngine || "Unknown",
        bodyType: toStr(row.detail_body_type) || "Unknown",
        transmission: toStr(row.detail_transmission) || "Unknown",
      });
    }
  }
  return rows;
}

function writeProjectChunks(project, rows, meta) {
  const projectDir = path.join(OUT_DIR, project);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  const chunks = [];
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const slice = rows.slice(offset, offset + CHUNK_SIZE);
    const chunkName = `chunk-${String(chunks.length).padStart(3, "0")}.json`;
    const key = `${project}/${chunkName}`;
    writeFileSync(path.join(OUT_DIR, key), JSON.stringify(slice));
    chunks.push({ key, count: slice.length });
  }
  writeFileSync(path.join(projectDir, "index.json"), JSON.stringify({ total: rows.length, chunks, meta }));
  console.log(`${project}: ${rows.length} rows -> ${chunks.length} chunks`);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function numericBounds(values, fallback) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) return fallback;
  return min === max ? [min, max + 1] : [min, max];
}

function roomGroupLabel(rooms) {
  if (rooms == null) return "?";
  return rooms >= 5 ? "5+" : String(rooms);
}

function buildTrend(rows, metric) {
  const byPeriod = new Map();
  for (const row of rows) {
    const values = byPeriod.get(row.period) ?? [];
    values.push(metric(row));
    byPeriod.set(row.period, values);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => sortedPeriods([a, b]).indexOf(a) - sortedPeriods([a, b]).indexOf(b))
    .map(([period, values]) => ({ period, medianPrice: median(values), count: values.length }));
}

function buildBreakdowns(rows, dims, metric) {
  const aggregate = {};
  const monthly = {};
  for (const [dim, getKey] of Object.entries(dims)) {
    const aggregateMap = new Map();
    const monthlyMap = new Map();

    for (const row of rows) {
      const key = getKey(row);
      const aggregateValues = aggregateMap.get(key) ?? [];
      aggregateValues.push(metric(row));
      aggregateMap.set(key, aggregateValues);

      const monthlyId = `${row.period}\u0000${key}`;
      const monthlyBucket = monthlyMap.get(monthlyId) ?? { period: row.period, key, values: [] };
      monthlyBucket.values.push(metric(row));
      monthlyMap.set(monthlyId, monthlyBucket);
    }

    aggregate[dim] = [...aggregateMap.entries()]
      .map(([key, values]) => ({
        key,
        medianPrice: median(values),
        count: values.length,
      }))
      .filter((point) => point.count >= 5)
      .sort((a, b) => b.medianPrice - a.medianPrice)
      .slice(0, 20);

    monthly[dim] = [...monthlyMap.values()]
      .map((bucket) => ({
        key: bucket.key,
        period: bucket.period,
        medianPrice: median(bucket.values),
        count: bucket.values.length,
      }))
      .filter((point) => point.count >= 5)
      .sort((a, b) => {
        const periodOrder = sortedPeriods([a.period, b.period]).indexOf(a.period) - sortedPeriods([a.period, b.period]).indexOf(b.period);
        if (periodOrder !== 0) return periodOrder;
        return b.medianPrice - a.medianPrice;
      })
      .slice(0, 60);
  }
  return { aggregate, monthly };
}

function writeSummary(project, rows, meta, config) {
  const projectDir = path.join(OUT_DIR, project);
  const defaultRows = config.defaultRows(rows);
  const metric = config.metric;
  const summary = {
    project,
    total: rows.length,
    meta,
    bounds: config.bounds(rows),
    defaultView: {
      count: defaultRows.length,
      trend: buildTrend(defaultRows, metric),
      breakdowns: buildBreakdowns(defaultRows, config.dims, metric),
    },
  };
  writeFileSync(path.join(projectDir, "summary.json"), JSON.stringify(summary));
  console.log(`${project}: summary -> ${defaultRows.length} default rows`);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const binaRows = await loadBinaRows();
const binaMeta = {
  periods: sortedPeriods(binaRows.map((r) => r.period)),
  operations: ["Sale", "Rent"],
  regions: [...new Set(binaRows.map((r) => r.region))].sort(),
  categories: [...new Set(binaRows.map((r) => r.category))].sort(),
  rooms: [...new Set(binaRows.map((r) => r.rooms).filter((x) => x !== null))].sort((a, b) => a - b),
};
writeProjectChunks("bina", binaRows, binaMeta);
writeSummary("bina", binaRows, binaMeta, {
  bounds: (rows) => ({
    price: numericBounds(rows.map((r) => r.price), [0, 1_000_000]),
    area: numericBounds(rows.map((r) => r.area), [0, 2_000]),
    unit: numericBounds(rows.map((r) => r.pricePerM2), [0, 10_000]),
  }),
  defaultRows: (rows) => {
    const saleRows = rows.filter((row) => row.operationType === "Sale");
    const counts = new Map();
    for (const row of saleRows) counts.set(row.region, (counts.get(row.region) ?? 0) + 1);
    return saleRows.filter((row) => (counts.get(row.region) ?? 0) >= 50);
  },
  metric: (row) => row.pricePerM2,
  dims: {
    rooms: (row) => roomGroupLabel(row.rooms),
    region: (row) => row.region,
    category: (row) => row.category,
  },
});

const marketsRows = await loadMarketsRows();
const marketsMeta = {
  periods: sortedPeriods(marketsRows.map((r) => r.period)),
  sources: [...new Set(marketsRows.map((r) => r.source))].sort(),
  categories: [...new Set(marketsRows.map((r) => r.category))].sort(),
  brands: [...new Set(marketsRows.map((r) => r.brand))].sort(),
};
writeProjectChunks("markets", marketsRows, marketsMeta);
writeSummary("markets", marketsRows, marketsMeta, {
  bounds: (rows) => ({
    price: numericBounds(rows.map((r) => r.price), [0, 1_000]),
  }),
  defaultRows: (rows) => rows,
  metric: (row) => row.price,
  dims: {
    source: (row) => row.source,
    category: (row) => row.category,
    brand: (row) => row.brand,
  },
});

const turboRows = await loadTurboRows();
const turboMeta = {
  periods: sortedPeriods(turboRows.map((r) => r.period)),
  brands: [...new Set(turboRows.map((r) => r.brand))].sort(),
  fuelTypes: [...new Set(turboRows.map((r) => r.fuelType))].sort(),
  bodyTypes: [...new Set(turboRows.map((r) => r.bodyType))].sort(),
  transmissions: [...new Set(turboRows.map((r) => r.transmission))].sort(),
};
writeProjectChunks("turbo", turboRows, turboMeta);
writeSummary("turbo", turboRows, turboMeta, {
  bounds: (rows) => ({
    price: numericBounds(rows.map((r) => r.price), [0, 1_000_000]),
    year: numericBounds(rows.map((r) => r.year).filter((v) => v != null), [1970, 2026]),
    mileage: numericBounds(rows.map((r) => r.mileage).filter((v) => v != null), [0, 500_000]),
  }),
  defaultRows: (rows) => {
    const counts = new Map();
    for (const row of rows) counts.set(row.brand, (counts.get(row.brand) ?? 0) + 1);
    return rows.filter((row) => (counts.get(row.brand) ?? 0) >= 20);
  },
  metric: (row) => row.price,
  dims: {
    fuelType: (row) => row.fuelType,
    bodyType: (row) => row.bodyType,
    transmission: (row) => row.transmission,
    brand: (row) => row.brand,
  },
});
