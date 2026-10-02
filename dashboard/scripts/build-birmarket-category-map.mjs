import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parquetRead } from "../node_modules/hyparquet/src/node.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARQUET_DIR = path.join(ROOT, "data", "birmarket");
const OUTPUT_PATH = path.join(ROOT, "data", "birmarket", "category-map.json");
const API_ROOT = "https://mp-catalog.umico.az/api/v1/categories";
const CONCURRENCY = 20;

// These are the catalog groups shown in Birmarket's main “Məhsul kataloqu” menu.
// The API also has broader technical roots (for example “Elektronika və məişət
// texnikası”), so matching these IDs gives the labels customers actually see.
const MENU_CATEGORY_LABELS = new Map([
  [2, "Telefonlar, Smart cihazlar və telefon aksessuarları"],
  [106, "Məişət texnikası"],
  [15, "Notbuk və kompüterlər"],
  [70, "TV, audio və video"],
  [937, "Ev əşyaları"],
  [1708, "Avtomobil məhsulları"],
  [257, "Gözəllik"],
  [5224, "Sağlamlıq"],
  [779, "Uşaqlar üçün"],
  [2492, "Qida məhsulları və içkilər"],
  [746, "Məişət kimyası"],
  [516, "İdman və Əyləncə"],
  [1232, "Bağ üçün məhsullar"],
  [4835, "Bir Gaming"],
  [2266, "Saat, zinət və bəzək əşyaları"],
  [204, "Foto və videokameralar"],
  [2627, "Təmir-tikinti"],
  [1657, "Kitablar, Hobbi, Məktəb və ofis ləvazimatları"],
  [2164, "Zoo məhsullar"],
  [3003, "Geyim, ayaqqabı və aksessuarlar"],
]);

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function parquetFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...parquetFiles(fullPath));
    else if (entry.toLowerCase().endsWith(".parquet")) files.push(fullPath);
  }
  return files;
}

async function readRows(filePath) {
  const buffer = readFileSync(filePath);
  return new Promise((resolve, reject) => {
    parquetRead({
      file: toArrayBuffer(buffer),
      rowFormat: "object",
      columns: ["category_id", "category"],
      onComplete: resolve,
    }).catch(reject);
  });
}

function categoryId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function fetchCategory(id, attempt = 1) {
  try {
    const response = await fetch(`${API_ROOT}/${id}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 4) throw new Error(`Category ${id}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)));
    return fetchCategory(id, attempt + 1);
  }
}

function hierarchy(detail) {
  const nodes = [{ id: detail.id, name: detail.name }];
  let parent = detail.parent;
  while (parent) {
    nodes.push({ id: parent.id, name: parent.name });
    parent = parent.parent;
  }
  return nodes;
}

function resolveCatalogCategory(detail) {
  const nodes = hierarchy(detail);
  for (const node of nodes) {
    const menuLabel = MENU_CATEGORY_LABELS.get(Number(node.id));
    if (menuLabel) return menuLabel;
  }
  return nodes.at(-1)?.name || "Digər";
}

const namesById = new Map();
for (const filePath of parquetFiles(PARQUET_DIR)) {
  const rawRows = await readRows(filePath);
  for (const row of rawRows) {
    const id = categoryId(row.category_id);
    if (id !== null && !namesById.has(id)) {
      namesById.set(id, String(row.category ?? "").trim() || "Unknown");
    }
  }
}

const ids = [...namesById.keys()].sort((a, b) => a - b);
const categoryMap = {};
let cursor = 0;
let completed = 0;

console.log(`Resolving ${ids.length} Birmarket categories from the official catalog API...`);

async function worker() {
  while (cursor < ids.length) {
    const id = ids[cursor++];
    const detail = await fetchCategory(id);
    categoryMap[id] = {
      category: resolveCatalogCategory(detail),
      subcategory: namesById.get(id),
    };
    completed += 1;
    if (completed % 100 === 0 || completed === ids.length) {
      console.log(`${completed}/${ids.length}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `${JSON.stringify({
    source: API_ROOT,
    generatedAt: new Date().toISOString(),
    categories: categoryMap,
  }, null, 2)}\n`,
);

console.log(`Saved ${Object.keys(categoryMap).length} mappings to ${OUTPUT_PATH}`);
