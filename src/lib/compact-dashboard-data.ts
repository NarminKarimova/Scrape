import type { BinaRow, MarketsRow, ProjectKey, TurboRow } from "@/lib/dashboard-data";

export type CompactRow = (number | string | null)[];
export type DashboardRow = BinaRow | MarketsRow | TurboRow;

function indexByValue(values: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(values)) return map;
  values.forEach((value, index) => map.set(String(value), index));
  return map;
}

function compactValue(map: Map<string, number>, value: string): number | string {
  return map.get(value) ?? value;
}

function lookup(values: unknown, value: number | string | null): string {
  if (typeof value === "number" && Array.isArray(values)) {
    return String(values[value] ?? "");
  }
  return value == null ? "" : String(value);
}

export function compactRows(
  project: ProjectKey,
  rows: DashboardRow[],
  meta: Record<string, unknown> | undefined,
): CompactRow[] {
  if (!meta) return rows as unknown as CompactRow[];
  const periods = indexByValue(meta.periods);

  if (project === "Bina.az") {
    const operations = indexByValue(meta.operations);
    const regions = indexByValue(meta.regions);
    const categories = indexByValue(meta.categories);
    return (rows as BinaRow[]).map((row) => [
      compactValue(periods, row.period),
      compactValue(operations, row.operationType),
      compactValue(regions, row.region),
      compactValue(categories, row.category),
      row.rooms,
      row.price,
      row.area,
      row.pricePerM2,
    ]);
  }

  if (project === "Markets") {
    const sources = indexByValue(meta.sources);
    const categories = indexByValue(meta.categories);
    const brands = indexByValue(meta.brands);
    return (rows as MarketsRow[]).map((row) => [
      compactValue(periods, row.period),
      compactValue(sources, row.source),
      compactValue(categories, row.category),
      compactValue(brands, row.brand),
      row.price,
    ]);
  }

  const brands = indexByValue(meta.brands);
  const fuelTypes = indexByValue(meta.fuelTypes);
  const bodyTypes = indexByValue(meta.bodyTypes);
  const transmissions = indexByValue(meta.transmissions);
  return (rows as TurboRow[]).map((row) => [
    compactValue(periods, row.period),
    compactValue(brands, row.brand),
    row.price,
    row.year,
    row.mileage,
    compactValue(fuelTypes, row.fuelType),
    compactValue(bodyTypes, row.bodyType),
    compactValue(transmissions, row.transmission),
  ]);
}

export function decodeCompactRows(
  project: ProjectKey,
  rows: CompactRow[],
  meta: Record<string, unknown>,
): DashboardRow[] {
  if (project === "Bina.az") {
    return rows.map((row) => ({
      period: lookup(meta.periods, row[0]),
      operationType: lookup(meta.operations, row[1]) as "Sale" | "Rent",
      region: lookup(meta.regions, row[2]),
      category: lookup(meta.categories, row[3]),
      rooms: row[4] == null ? null : Number(row[4]),
      price: Number(row[5]),
      area: Number(row[6]),
      pricePerM2: Number(row[7]),
    }));
  }

  if (project === "Markets") {
    return rows.map((row) => ({
      period: lookup(meta.periods, row[0]),
      source: lookup(meta.sources, row[1]),
      category: lookup(meta.categories, row[2]),
      brand: lookup(meta.brands, row[3]),
      price: Number(row[4]),
    }));
  }

  return rows.map((row) => ({
    period: lookup(meta.periods, row[0]),
    brand: lookup(meta.brands, row[1]),
    price: Number(row[2]),
    year: row[3] == null ? null : Number(row[3]),
    mileage: row[4] == null ? null : Number(row[4]),
    fuelType: lookup(meta.fuelTypes, row[5]),
    bodyType: lookup(meta.bodyTypes, row[6]),
    transmission: lookup(meta.transmissions, row[7]),
  }));
}
