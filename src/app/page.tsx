"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { decodeCompactRows, type CompactRow } from "@/lib/compact-dashboard-data";
import { MarketChat, type AnalysisContext } from "@/components/market-chat";
import { MarketOverallSummary } from "@/components/market-overall-summary";
import type { DashboardSummary, SummaryBreakdownPoint } from "@/lib/dashboard-summary";

type ProjectKey = "Bina.az" | "Markets" | "Turbo.az";

type BinaRow = {
  period: string;
  operationType: "Sale" | "Rent";
  region: string;
  category: string;
  rooms: number | null;
  price: number;
  area: number;
  pricePerM2: number;
};

type MarketsRow = {
  period: string;
  source: string;
  category: string;
  brand: string;
  price: number;
};

type TurboRow = {
  period: string;
  brand: string;
  price: number;
  year: number | null;
  mileage: number | null;
  fuelType: string;
  bodyType: string;
  transmission: string;
};

type AnyRow = BinaRow | MarketsRow | TurboRow;

type RegionMode = "all" | "top10" | "top20" | "custom";
type BrandMode = "all" | "top10" | "top20" | "custom";

type ApiResponse = {
  project: ProjectKey;
  rows: AnyRow[] | CompactRow[];
  compact?: boolean;
  meta?: Record<string, unknown>;
  page?: {
    cursor: number;
    nextCursor: number | null;
    hasMore: boolean;
    total: number;
    pageSize: number;
  };
};

type TrendPoint = {
  period: string;
  dateLabel: string;
  medianPrice: number;
  pctChange: number;
  pctLabel: string;
};

type Insight = {
  text: string;
  tone: "green" | "red" | "blue" | "amber" | "neutral";
};

type BreakdownPoint = {
  key: string;
  medianPrice: number;
  count: number;
  valueLabel: string;
  period?: string;
  dateLabel?: string;
};

type TrendDatum = TrendPoint & Record<string, string | number>;

type ListingCountBasePoint = {
  period: string;
  dateLabel: string;
  count: number;
} & Record<string, string | number>;

type ListingCountPoint = ListingCountBasePoint & {
  pctChange: number;
  pctLabel: string;
};

type ChartLabelProps = {
  x?: unknown;
  y?: unknown;
  value?: unknown;
  index?: number;
};

type TrendDotProps = {
  cx?: number;
  cy?: number;
  payload?: {
    pctChange?: number;
  };
};

type Lang = "en" | "az";

const I18N: Record<Lang, Record<string, string>> = {
  en: {
    marketAnalytics: "Market Analytics",
    loading: "Loading…",
    rows: "rows",
    months: "Months",
    operation: "Operation",
    regions: "Regions",
    categories: "Categories",
    rooms: "Rooms",
    sources: "Sources",
    brands: "Brands",
    fuelTypes: "Fuel types",
    transmissions: "Transmissions",
    bodyTypes: "Body types",
    regionRules: "Region rules",
    brandRules: "Brand rules",
    all: "All",
    top10: "Top 10",
    top20: "Top 20",
    custom: "Custom",
    minAdsRegion: "Min ads per region",
    minAdsBrand: "Min ads per brand",
    priceRange: "Price range (₼)",
    areaRange: "Area range (m²)",
    unitPriceRange: "Unit price range (₼/m²)",
    yearRange: "Year range",
    mileageRange: "Mileage range (km)",
    dashboard: "Dashboard",
    aggregatedMedian: "Aggregated median from selected filters",
    aggregatedCount: "Total count from selected filters",
    filteredListings: "Filtered listings",
    medianPriceM2: "Median Price / m²",
    medianPrice: "Median Price (₼)",
    prev: "Prev",
    latestPeriodChange: "Latest period change",
    priceTrend: "Price trend — aggregated median",
    listingsTrend: "Listings trend — monthly count",
    listingCountChangeTitle: "Listing count change (% rise / drop)",
    percentChangeTitle: "Percent change (+ rise / − drop)",
    change: "Change",
    noPreviousPeriod: "No previous period",
    drop: "drop",
    rise: "rise",
    noChange: "no change",
    failedLoad: "Failed to load dashboard data",
    search: "Search",
    selectAll: "Select all",
    noResults: "No results",
    reset: "Reset",
    noDataTitle: "No data for selected filters",
    noDataHint: "Adjust filters or reset to defaults.",
    lightMode: "Light",
    darkMode: "Dark",
    breakdown: "Breakdown — median price by segment",
    byRooms: "By room count",
    bySource: "By source",
    byFuelType: "By fuel type",
    byRegion: "By region",
    byCategory: "By category",
    byBrand: "By brand",
    byBodyType: "By body type",
    byTransmission: "By transmission",
    groupBy: "Group by",
    countLabel: "Count",
    activeFilters: "active filters",
    filters: "Filters",
    totalLoaded: "total loaded",
    splitBySelection: "Split lines",
    insights: "Market signals",
    aggregate: "Aggregate",
    monthly: "Monthly",
    priceInsight: "Price",
    volumeInsight: "Volume",
    segmentInsight: "Segment",
    sampleInsight: "Sample",
  },
  az: {
    marketAnalytics: "Bazar Analitikası",
    loading: "Yüklənir…",
    rows: "sətir",
    months: "Aylar",
    operation: "Əməliyyat",
    regions: "Regionlar",
    categories: "Kateqoriyalar",
    rooms: "Otaqlar",
    sources: "Mənbələr",
    brands: "Brendlər",
    fuelTypes: "Yanacaq növləri",
    transmissions: "Sürətlər qutusu",
    bodyTypes: "Ban növləri",
    regionRules: "Region qaydaları",
    brandRules: "Brend qaydaları",
    all: "Hamısı",
    top10: "İlk 10",
    top20: "İlk 20",
    custom: "Xüsusi",
    minAdsRegion: "Region üzrə min elan",
    minAdsBrand: "Brend üzrə min elan",
    priceRange: "Qiymət aralığı (₼)",
    areaRange: "Sahə aralığı (m²)",
    unitPriceRange: "Vahid qiymət aralığı (₼/m²)",
    yearRange: "İl aralığı",
    mileageRange: "Yürüş aralığı (km)",
    dashboard: "Panel",
    aggregatedMedian: "Seçilmiş filtrlər üzrə aqreqat median",
    aggregatedCount: "Seçilmiş filtrlər üzrə ümumi say",
    filteredListings: "Filtrlənmiş elanlar",
    medianPriceM2: "Median Qiymət / m²",
    medianPrice: "Median Qiymət (₼)",
    prev: "Əvvəlki",
    latestPeriodChange: "Son dövr dəyişimi",
    priceTrend: "Qiymət trendi — aqreqat median",
    listingsTrend: "Elan trendi — aylıq say",
    listingCountChangeTitle: "Elan sayı dəyişimi (% artım / azalma)",
    percentChangeTitle: "Faiz dəyişimi (+ artım / − azalma)",
    change: "Dəyişim",
    noPreviousPeriod: "Əvvəlki dövr yoxdur",
    drop: "azalma",
    rise: "artım",
    noChange: "dəyişiklik yoxdur",
    failedLoad: "Dashboard məlumatları yüklənmədi",
    search: "Axtar",
    selectAll: "Hamısını seç",
    noResults: "Nəticə tapılmadı",
    reset: "Sıfırla",
    noDataTitle: "Seçilmiş filtrlər üçün məlumat yoxdur",
    noDataHint: "Filtrləri dəyişin və ya standartlara qaytarın.",
    lightMode: "İşıqlı",
    darkMode: "Qaranlıq",
    breakdown: "Analiz — median qiymət seqmentə görə",
    byRooms: "Otaq sayına görə",
    bySource: "Mənbəyə görə",
    byFuelType: "Yanacaq növünə görə",
    byRegion: "Regiona görə",
    byCategory: "Kateqoriyaya görə",
    byBrand: "Brendə görə",
    byBodyType: "Ban növünə görə",
    byTransmission: "Sürətlər qutusuna görə",
    groupBy: "Qruplaşdır",
    countLabel: "Say",
    activeFilters: "aktiv filtrlər",
    filters: "Filtrlər",
    totalLoaded: "yükləndi",
    splitBySelection: "Xətləri ayır",
    insights: "Bazar siqnalları",
    aggregate: "Aqreqat",
    monthly: "Aylıq",
    priceInsight: "Qiymət",
    volumeInsight: "Həcm",
    segmentInsight: "Seqment",
    sampleInsight: "Nümunə",
  },
};

function periodToLabel(period: string, locale: string): string {
  const suffix = period.match(/\s*\((H1|H2)\)\s*$/i)?.[0] ?? "";
  const normalized = period.replace(/\s*\((H1|H2)\)\s*$/i, "");
  const [y, m] = normalized.split("-").map(Number);
  if (!y || !m) return period;
  const d = new Date(y, m - 1, 1);
  return `${d.toLocaleDateString(locale, { month: "short", year: "numeric" })}${suffix}`;
}

function roomGroupLabel(rooms: number | null): string {
  if (rooms == null) return "?";
  return rooms >= 5 ? "5+" : String(rooms);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function numericBounds(
  values: number[],
  fallback: [number, number],
): [number, number] {
  if (!values.length) return fallback;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY)
    return fallback;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  if (min === max) return [min, max + 1];
  return [min, max];
}

function clampRange(
  value: [number, number],
  bounds: [number, number],
): [number, number] {
  const lo = Math.max(bounds[0], Math.min(bounds[1], value[0]));
  const hi = Math.max(bounds[0], Math.min(bounds[1], value[1]));
  return lo <= hi ? [lo, hi] : [bounds[0], bounds[1]];
}

function withPercentChange(
  points: Omit<TrendPoint, "pctChange" | "pctLabel">[],
  labels: {
    noPreviousPeriod: string;
    drop: string;
    rise: string;
    noChange: string;
  },
): TrendPoint[] {
  if (points.length === 0) return [];
  const basePrice = points[0].medianPrice;

  return points.map((point, idx) => {
    if (idx === 0 || !basePrice) {
      return { ...point, pctChange: 0, pctLabel: labels.noPreviousPeriod };
    }
    const value = ((point.medianPrice - basePrice) / basePrice) * 100;
    const dir =
      value < 0 ? labels.drop : value > 0 ? labels.rise : labels.noChange;
    const label = `${Math.abs(value).toFixed(2)}% ${dir}`;
    return { ...point, pctChange: value, pctLabel: label };
  });
}

function buildChartDomain(
  values: number[],
  options?: {
    paddingRatio?: number;
    minPadding?: number;
    clampMin?: number;
    includeValues?: number[];
  },
): [number, number] {
  const {
    paddingRatio = 0.12,
    minPadding = 1,
    clampMin,
    includeValues = [],
  } = options ?? {};

  const finiteValues = [...values, ...includeValues].filter((value) =>
    Number.isFinite(value),
  );
  if (finiteValues.length === 0) return [0, 1];

  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  const span = max - min;
  const reference = span === 0 ? Math.max(Math.abs(max), 1) : span;
  const padding = Math.max(reference * paddingRatio, minPadding);

  min -= padding;
  max += padding;

  if (clampMin != null) {
    min = Math.max(clampMin, min);
  }

  if (min === max) {
    max = min + minPadding;
  }

  return [min, max];
}

// ─── Filter components ────────────────────────────────────────────────────────

function MonthChips({
  options,
  value,
  onChange,
  locale,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  locale: string;
}) {
  const toggle = (p: string) =>
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((p) => {
        const active = value.includes(p);
        return (
          <button
            key={p}
            onClick={() => toggle(p)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              active
                ? "border-blue-500 bg-blue-500/20 text-blue-600 dark:text-blue-300"
                : "border-slate-300 bg-slate-100/50 text-zinc-500 hover:border-slate-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
            }`}
          >
            {periodToLabel(p, locale)}
          </button>
        );
      })}
    </div>
  );
}

// Parse period labels into sortable keys (year, month, H1/H2 flag)
function periodKey(p: string) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const part = /q1|h1|\(H1\)/i.test(p) ? 1 : /q2|h2|\(H2\)/i.test(p) ? 2 : 0;
  const yymm = p.match(/(\d{4})-?(\d{2})/);
  if (yymm) {
    const y = Number(yymm[1]);
    const m = Number(yymm[2]);
    return { y, m, part };
  }

  const short = String(p).trim();
  const idx = monthNames.findIndex((n) => short.startsWith(n));
  const m = idx >= 0 ? idx + 1 : 999;
  return { y: 0, m, part };
}

function periodCompare(a: string, b: string) {
  const A = periodKey(a);
  const B = periodKey(b);
  if (A.y !== B.y) return A.y - B.y;
  if (A.m !== B.m) return A.m - B.m;
  if (A.part !== B.part) return A.part - B.part;
  return a.localeCompare(b);
}

function PillToggle({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5 rounded-xl bg-slate-200 p-1 dark:bg-zinc-800">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            value === opt.value
              ? "bg-white text-zinc-900 shadow dark:bg-zinc-600 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SourcePills({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (s: string) =>
    onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((s) => {
        const active = value.includes(s);
        return (
          <button
            key={s}
            onClick={() => toggle(s)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
              active
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
                : "border-slate-300 bg-slate-100/50 text-zinc-500 hover:border-slate-400 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function CheckboxList({
  label,
  options,
  value,
  onChange,
  ui,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  ui?: {
    search: string;
    selectAll: string;
    noResults: string;
    all: string;
  };
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const visible = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase()),
  );
  const allOn = value.length === options.length;
  const someOn = value.length > 0 && !allOn;

  const toggleAll = () => onChange(allOn ? [] : [...options]);
  const toggle = (o: string) =>
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-slate-100/60 px-3 py-2 text-sm text-zinc-700 transition hover:border-slate-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:border-zinc-500"
      >
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-1.5">
          {(someOn || allOn) && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">
              {allOn ? (ui?.all ?? "All") : value.length}
            </span>
          )}
          <svg
            className={`h-4 w-4 text-zinc-400 transition-transform dark:text-zinc-400 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="p-2">
            <input
              autoFocus
              placeholder={`${ui?.search ?? "Search"} ${label.toLowerCase()}\u2026`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:border-slate-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-zinc-500"
            />
          </div>
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 pb-2 dark:border-zinc-800">
            <input
              id={`all-${label}`}
              type="checkbox"
              checked={allOn}
              ref={(el) => {
                if (el) el.indeterminate = someOn;
              }}
              onChange={toggleAll}
              className="accent-blue-500"
            />
            <label
              htmlFor={`all-${label}`}
              className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400"
            >
              {ui?.selectAll ?? "Select all"} ({options.length})
            </label>
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {visible.map((o) => (
              <li key={o}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    checked={value.includes(o)}
                    onChange={() => toggle(o)}
                    className="accent-blue-500"
                  />
                  <span className="truncate text-xs text-zinc-600 dark:text-zinc-300">
                    {o}
                  </span>
                </label>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-500">
                {ui?.noResults ?? "No results"}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
  history,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red" | "neutral";
  history?: { label: string; value: string }[];
}) {
  const accentClass =
    accent === "green"
      ? "text-emerald-500 dark:text-emerald-400"
      : accent === "red"
        ? "text-rose-500 dark:text-rose-400"
        : "text-zinc-900 dark:text-zinc-100";
  const borderClass =
    accent === "green"
      ? "border-emerald-200/60 dark:border-emerald-900/40"
      : accent === "red"
        ? "border-rose-200/60 dark:border-rose-900/40"
        : "border-slate-200/80 dark:border-zinc-800/80";

  return (
    <div
      className={`relative flex min-h-[140px] flex-col justify-between overflow-hidden rounded-2xl border ${borderClass} bg-gradient-to-br from-white to-slate-50/60 p-5 shadow-sm transition-all hover:shadow-md dark:from-zinc-900 dark:to-zinc-900/40`}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            {label}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-3xl font-extrabold tabular-nums tracking-tight ${accentClass}`}
          >
            {value}
          </span>
          {sub && (
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              {sub}
            </span>
          )}
        </div>
      </div>

      {history && history.length > 0 && (
        <div className="mt-4 flex gap-3 border-t border-slate-100 pt-3 dark:border-zinc-800/50">
          {history.map((item, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[9px] font-medium uppercase text-zinc-400 dark:text-zinc-500">
                {item.label}
              </span>
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chart wrapper ─────────────────────────────────────────────────────────────

function Chart({
  children,
  height = 300,
}: {
  children: React.ReactNode;
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!mounted) {
    return (
      <div
        style={{ width: "100%", height }}
        className="rounded-xl bg-slate-100/60 dark:bg-zinc-900/40"
      />
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/40 p-6 shadow-sm dark:border-zinc-800/80 dark:from-zinc-900 dark:to-zinc-900/40">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          {title}
        </p>
        {extra && <div>{extra}</div>}
      </div>
      {children}
    </div>
  );
}

function InsightReadout({ insights }: { insights: Insight[] }) {
  const toneClasses: Record<Insight["tone"], string> = {
    green: "bg-emerald-500",
    red: "bg-rose-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    neutral: "bg-zinc-400",
  };

  return (
    <ul className="grid gap-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300 lg:grid-cols-2">
      {insights.map((insight, index) => (
        <li key={`${index}-${insight.text}`} className="flex gap-3">
          <span
            className={`mt-2 h-2 w-2 shrink-0 rounded-full ${toneClasses[insight.tone]}`}
          />
          <span>{insight.text}</span>
        </li>
      ))}
    </ul>
  );
}

function FilterSection({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between py-1 text-left"
        onClick={() => setOpen((p) => !p)}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          {title}
        </span>
        <span className="flex items-center gap-1.5">
          {badge != null && badge > 0 && (
            <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold leading-none text-blue-600 dark:text-blue-400">
              {badge}
            </span>
          )}
          <svg
            className={`h-3 w-3 text-zinc-400 transition-transform duration-150 ${
              open ? "" : "-rotate-90"
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </button>
      {open && <div className="mt-2 space-y-2.5">{children}</div>}
    </div>
  );
}

// Locale-independent compact formatter — avoids SSR/client hydration mismatch
function fmtNum(v: number): string {
  if (v >= 1_000_000)
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v / 1_000_000)}M`;
  if (v >= 100_000)
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v / 1_000)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
}

function fmtFixed(v: number, fractionDigits: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function fmtSignedPercent(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function NumberRangeFilter({
  value,
  onChange,
  bounds,
  step = 1,
  formatter,
}: {
  value: [number, number];
  onChange: (next: [number, number]) => void;
  bounds: [number, number];
  step?: number;
  formatter?: (v: number) => string;
}) {
  const fmt = formatter ?? fmtNum;
  const rangeWidth = bounds[1] - bounds[0] || 1;
  const leftPct = Math.max(
    0,
    Math.min(100, ((value[0] - bounds[0]) / rangeWidth) * 100),
  );
  const rightPct = Math.max(
    0,
    Math.min(100, ((value[1] - bounds[0]) / rangeWidth) * 100),
  );

  return (
    <div className="px-1 pt-8 pb-1">
      <div className="relative h-1.5">
        {/* Background track */}
        <div className="absolute inset-0 rounded-full bg-slate-200 dark:bg-zinc-700" />
        {/* Active fill */}
        <div
          className="absolute h-1.5 rounded-full bg-blue-500"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        {/* Min label bubble */}
        <div
          className="pointer-events-none absolute bottom-full mb-2.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow"
          style={{ left: `${leftPct}%` }}
        >
          {fmt(value[0])}
        </div>
        {/* Max label bubble */}
        <div
          className="pointer-events-none absolute bottom-full mb-2.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-blue-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow"
          style={{ left: `${rightPct}%` }}
        >
          {fmt(value[1])}
        </div>
        {/* Min thumb */}
        <input
          type="range"
          className="range-thumb"
          min={bounds[0]}
          max={bounds[1]}
          step={step}
          value={value[0]}
          onChange={(e) =>
            onChange(clampRange([Number(e.target.value), value[1]], bounds))
          }
        />
        {/* Max thumb */}
        <input
          type="range"
          className="range-thumb"
          min={bounds[0]}
          max={bounds[1]}
          step={step}
          value={value[1]}
          onChange={(e) =>
            onChange(clampRange([value[0], Number(e.target.value)], bounds))
          }
        />
      </div>
      {/* Bound labels */}
      <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
        <span>{fmt(bounds[0])}</span>
        <span>{fmt(bounds[1])}</span>
      </div>
      {/* Manual inputs */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          type="number"
          min={bounds[0]}
          max={bounds[1]}
          step={step}
          value={value[0]}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clampRange([n, value[1]], bounds));
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-blue-500"
        />
        <input
          type="number"
          min={bounds[0]}
          max={bounds[1]}
          step={step}
          value={value[1]}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clampRange([value[0], n], bounds));
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-blue-500"
        />
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-8 text-center dark:border-zinc-800/80 dark:bg-zinc-900/40">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {title}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

export default function Home() {
  const [splitTrend, setSplitTrend] = useState(false);
  const [project, setProject] = useState<ProjectKey>("Bina.az");
  const [lang, setLang] = useState<Lang>("az");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ApiResponse["rows"]>([]);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  const [periods, setPeriods] = useState<string[]>([]);
  const [operationType, setOperationType] = useState<"Sale" | "Rent">("Sale");
  const [regions, setRegions] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [regionMode, setRegionMode] = useState<RegionMode>("all");
  const [minRegionAds, setMinRegionAds] = useState<number>(50);
  const [binaPriceBounds, setBinaPriceBounds] = useState<[number, number]>([
    0, 1_000_000,
  ]);
  const [binaAreaBounds, setBinaAreaBounds] = useState<[number, number]>([
    0, 2_000,
  ]);
  const [binaUnitBounds, setBinaUnitBounds] = useState<[number, number]>([
    0, 10_000,
  ]);
  const [binaPriceRange, setBinaPriceRange] = useState<[number, number]>([
    0, 1_000_000,
  ]);
  const [binaAreaRange, setBinaAreaRange] = useState<[number, number]>([
    0, 2_000,
  ]);
  const [binaUnitRange, setBinaUnitRange] = useState<[number, number]>([
    0, 10_000,
  ]);

  const [marketsPriceBounds, setMarketsPriceBounds] = useState<
    [number, number]
  >([0, 1_000]);
  const [marketsPriceRange, setMarketsPriceRange] = useState<[number, number]>([
    0, 1_000,
  ]);

  const [turboBrandMode, setTurboBrandMode] = useState<BrandMode>("all");
  const [turboMinAds, setTurboMinAds] = useState<number>(20);
  const [turboFuelTypes, setTurboFuelTypes] = useState<string[]>([]);
  const [turboBodyTypes, setTurboBodyTypes] = useState<string[]>([]);
  const [turboTransmissions, setTurboTransmissions] = useState<string[]>([]);
  const [turboPriceBounds, setTurboPriceBounds] = useState<[number, number]>([
    0, 1_000_000,
  ]);
  const [turboYearBounds, setTurboYearBounds] = useState<[number, number]>([
    1970, 2026,
  ]);
  const [turboMileageBounds, setTurboMileageBounds] = useState<
    [number, number]
  >([0, 500_000]);
  const [turboPriceRange, setTurboPriceRange] = useState<[number, number]>([
    0, 1_000_000,
  ]);
  const [turboYearRange, setTurboYearRange] = useState<[number, number]>([
    1970, 2026,
  ]);
  const [turboMileageRange, setTurboMileageRange] = useState<[number, number]>([
    0, 500_000,
  ]);

  // Breakdown dimension selection per project
  const [breakdownDimBina, setBreakdownDimBina] = useState<
    "rooms" | "region" | "category"
  >("rooms");
  const [breakdownDimMarkets, setBreakdownDimMarkets] = useState<
    "source" | "category" | "brand"
  >("source");
  const [breakdownDimTurbo, setBreakdownDimTurbo] = useState<
    "fuelType" | "bodyType" | "transmission"
  >("fuelType");
  const [breakdownMode, setBreakdownMode] = useState<"aggregate" | "monthly">(
    "aggregate",
  );

  const allRooms = useMemo(
    () => {
      const present = new Set(
        ((meta.rooms as number[]) ?? []).map((room) => roomGroupLabel(room)),
      );
      return ["1", "2", "3", "4", "5+"].filter((room) => present.has(room));
    },
    [meta.rooms],
  );
  const t = useCallback((key: string) => I18N[lang][key] ?? key, [lang]);
  const dateLocale = lang === "az" ? "az-AZ" : "en-US";
  const isLight = theme === "light";

  // Dynamic chart styles based on theme
  const shared = {
    contentStyle: {
      background: isLight ? "#ffffff" : "#18181b",
      border: `1px solid ${isLight ? "#e4e4e7" : "#3f3f46"}`,
      borderRadius: "0.75rem",
      fontSize: "0.8rem",
    },
    labelStyle: {
      color: isLight ? "#18181b" : "#e4e4e7",
      fontWeight: 600 as const,
    },
    itemStyle: { color: isLight ? "#52525b" : "#a1a1aa" },
  };

  const chartColors = {
    grid: isLight ? "#e4e4e7" : "#27272a",
    axis: isLight ? "#a1a1aa" : "#52525b",
    tick: isLight ? "#52525b" : "#71717a",
  };

  // 1. Initial theme load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("dashboard-theme") as
      | "dark"
      | "light"
      | null;
    if (saved) {
      setTheme(saved);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
  }, []);

  // 2. Sync theme class to <html> and save to localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.classList.remove("light");
    } else {
      root.classList.remove("dark");
      root.classList.add("light");
    }
    localStorage.setItem("dashboard-theme", theme);
  }, [theme]);

  const checkboxUi = {
    search: t("search"),
    selectAll: t("selectAll"),
    noResults: t("noResults"),
    all: t("all"),
  };

  // ── Active filter count per project ─────────────────────────────────────────
  const activeFilterCount = useMemo(() => {
    const allPeriodList = (meta.periods as string[]) ?? [];
    let n = periods.length !== allPeriodList.length ? 1 : 0;
    if (project === "Bina.az") {
      if (operationType !== "Sale") n++;
      const mr = (meta.regions as string[]) ?? [];
      if (regions.length !== mr.length) n++;
      const mc = (meta.categories as string[]) ?? [];
      if (categories.length !== mc.length) n++;
      if (rooms.length > 0) n++; // rooms=[] means "no filter"; any selection = active filter
      if (
        binaPriceRange[0] !== binaPriceBounds[0] ||
        binaPriceRange[1] !== binaPriceBounds[1]
      )
        n++;
      if (
        binaAreaRange[0] !== binaAreaBounds[0] ||
        binaAreaRange[1] !== binaAreaBounds[1]
      )
        n++;
      if (
        binaUnitRange[0] !== binaUnitBounds[0] ||
        binaUnitRange[1] !== binaUnitBounds[1]
      )
        n++;
    } else if (project === "Markets") {
      const ms = (meta.sources as string[]) ?? [];
      if (sources.length !== ms.length) n++;
      const mc = (meta.categories as string[]) ?? [];
      if (categories.length !== mc.length) n++;
      const mb = (meta.brands as string[]) ?? [];
      if (brands.length !== mb.length) n++;
      if (
        marketsPriceRange[0] !== marketsPriceBounds[0] ||
        marketsPriceRange[1] !== marketsPriceBounds[1]
      )
        n++;
    } else {
      const mb = (meta.brands as string[]) ?? [];
      if (brands.length !== mb.length) n++;
      const mf = (meta.fuelTypes as string[]) ?? [];
      if (turboFuelTypes.length !== mf.length) n++;
      const mbo = (meta.bodyTypes as string[]) ?? [];
      if (turboBodyTypes.length !== mbo.length) n++;
      const mt = (meta.transmissions as string[]) ?? [];
      if (turboTransmissions.length !== mt.length) n++;
      if (
        turboPriceRange[0] !== turboPriceBounds[0] ||
        turboPriceRange[1] !== turboPriceBounds[1]
      )
        n++;
      if (
        turboYearRange[0] !== turboYearBounds[0] ||
        turboYearRange[1] !== turboYearBounds[1]
      )
        n++;
      if (
        turboMileageRange[0] !== turboMileageBounds[0] ||
        turboMileageRange[1] !== turboMileageBounds[1]
      )
        n++;
    }
    return n;
  }, [
    project,
    meta,
    periods,
    operationType,
    regions,
    categories,
    rooms,
    sources,
    brands,
    turboFuelTypes,
    turboBodyTypes,
    turboTransmissions,
    binaPriceRange,
    binaPriceBounds,
    binaAreaRange,
    binaAreaBounds,
    binaUnitRange,
    binaUnitBounds,
    marketsPriceRange,
    marketsPriceBounds,
    turboPriceRange,
    turboPriceBounds,
    turboYearRange,
    turboYearBounds,
    turboMileageRange,
    turboMileageBounds,
  ]);

  const resetCurrentProjectFilters = () => {
    const periodValues = (meta.periods as string[]) ?? [];
    setPeriods(periodValues);

    if (project === "Bina.az") {
      setOperationType("Sale");
      setRegions((meta.regions as string[]) ?? []);
      setCategories((meta.categories as string[]) ?? []);
      setRooms([]); // [] = no room filter
      setRegionMode("all");
      setMinRegionAds(50);
      setBinaPriceRange(binaPriceBounds);
      setBinaAreaRange(binaAreaBounds);
      setBinaUnitRange(binaUnitBounds);
    } else if (project === "Markets") {
      setSources((meta.sources as string[]) ?? []);
      setCategories((meta.categories as string[]) ?? []);
      setBrands((meta.brands as string[]) ?? []);
      setMarketsPriceRange(marketsPriceBounds);
    } else {
      setBrands((meta.brands as string[]) ?? []);
      setTurboBrandMode("all");
      setTurboMinAds(20);
      setTurboFuelTypes((meta.fuelTypes as string[]) ?? []);
      setTurboBodyTypes((meta.bodyTypes as string[]) ?? []);
      setTurboTransmissions((meta.transmissions as string[]) ?? []);
      setTurboPriceRange(turboPriceBounds);
      setTurboYearRange(turboYearBounds);
      setTurboMileageRange(turboMileageBounds);
    }
  };

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();
    const pageSize = 100_000;
    const parallelRequests = 3;

    const run = async () => {
      setLoading(true);
      setError(null);
      setRows([]);
      setMeta({});
      setSummary(null);
      try {
        const route = project === "Bina.az" ? "/api/data/bina" : project === "Markets" ? "/api/data/markets" : "/api/data/turbo";
        const summaryRoute = project === "Bina.az" ? "/api/summary/bina" : project === "Markets" ? "/api/summary/markets" : "/api/summary/turbo";
        const applySummaryState = (loadedSummary: DashboardSummary) => {
          const loadedMeta = loadedSummary.meta ?? {};
          setSummary(loadedSummary);
          setMeta(loadedMeta);
          setPeriods((loadedMeta.periods as string[]) ?? []);

          if (project === "Bina.az") {
            setOperationType("Sale");
            setRegions((loadedMeta.regions as string[]) ?? []);
            setCategories((loadedMeta.categories as string[]) ?? []);
            setRooms([]);
            setRegionMode("all");
            setMinRegionAds(50);
            const priceBounds = loadedSummary.bounds.price ?? [0, 1_000_000];
            const areaBounds = loadedSummary.bounds.area ?? [0, 2_000];
            const unitBounds = loadedSummary.bounds.unit ?? [0, 10_000];
            setBinaPriceBounds(priceBounds);
            setBinaAreaBounds(areaBounds);
            setBinaUnitBounds(unitBounds);
            setBinaPriceRange(priceBounds);
            setBinaAreaRange(areaBounds);
            setBinaUnitRange(unitBounds);
          } else if (project === "Markets") {
            setSources((loadedMeta.sources as string[]) ?? []);
            setCategories((loadedMeta.categories as string[]) ?? []);
            setBrands((loadedMeta.brands as string[]) ?? []);
            const priceBounds = loadedSummary.bounds.price ?? [0, 1_000];
            setMarketsPriceBounds(priceBounds);
            setMarketsPriceRange(priceBounds);
          } else {
            setBrands((loadedMeta.brands as string[]) ?? []);
            setTurboBrandMode("all");
            setTurboMinAds(20);
            setTurboFuelTypes((loadedMeta.fuelTypes as string[]) ?? []);
            setTurboBodyTypes((loadedMeta.bodyTypes as string[]) ?? []);
            setTurboTransmissions((loadedMeta.transmissions as string[]) ?? []);
            const priceBounds = loadedSummary.bounds.price ?? [0, 1_000_000];
            const yearBounds = loadedSummary.bounds.year ?? [1970, 2026];
            const mileageBounds = loadedSummary.bounds.mileage ?? [0, 500_000];
            setTurboPriceBounds(priceBounds);
            setTurboYearBounds(yearBounds);
            setTurboMileageBounds(mileageBounds);
            setTurboPriceRange(priceBounds);
            setTurboYearRange(yearBounds);
            setTurboMileageRange(mileageBounds);
          }
        };

        fetch(summaryRoute, { signal: controller.signal })
          .then((response) => (response.ok ? response.json() as Promise<DashboardSummary> : null))
          .then((loadedSummary) => {
            if (isActive && loadedSummary) applySummaryState(loadedSummary);
          })
          .catch(() => {
            // Raw row load below remains source of truth if summary is unavailable.
          });

        const fetchPage = async (cursor: number, includeMeta: boolean) => {
          const query = new URLSearchParams({
            cursor: String(cursor),
            pageSize: String(pageSize),
            includeMeta: includeMeta ? "1" : "0",
            compact: "1",
          });
          const response = await fetch(`${route}?${query.toString()}`, {
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json() as Promise<ApiResponse>;
        };

        const firstPage = await fetchPage(0, true);
        const mergedMeta: Record<string, unknown> = firstPage.meta ?? {};
        const readRows = (pageData: ApiResponse): AnyRow[] =>
          pageData.compact
            ? decodeCompactRows(project, pageData.rows as CompactRow[], mergedMeta)
            : pageData.rows as AnyRow[];
        const mergedRows: AnyRow[] = readRows(firstPage);
        const total = firstPage.page?.total ?? mergedRows.length;
        const effectivePageSize = firstPage.page?.pageSize ?? pageSize;
        const cursors: number[] = [];

        if (firstPage.page?.nextCursor != null) {
          for (let cursor = firstPage.page.nextCursor; cursor < total; cursor += effectivePageSize) {
            cursors.push(cursor);
          }
        }

        for (let i = 0; i < cursors.length; i += parallelRequests) {
          const batch = cursors.slice(i, i + parallelRequests);
          const pages = await Promise.all(batch.map((cursor) => fetchPage(cursor, false)));
          if (!isActive) return;
          for (const pageData of pages) {
            mergedRows.push(...readRows(pageData));
          }
        }

        const data: ApiResponse = {
          project,
          rows: mergedRows,
          meta: mergedMeta,
        };

        if (!isActive) return;

        setRows(data.rows);
        setMeta(data.meta ?? {});

        const initialPeriods = (data.meta?.periods as string[]) ?? [];
        setPeriods(initialPeriods);

        if (project === "Bina.az") {
          const typed = data.rows as BinaRow[];
          setOperationType("Sale");
          setRegions((data.meta?.regions as string[]) ?? []);
          setCategories((data.meta?.categories as string[]) ?? []);
          setRooms([]); // [] = no room filter → shows all rows including null-room properties
          setRegionMode("all");
          setMinRegionAds(50);

          const priceBounds = numericBounds(
            typed.map((r) => r.price),
            [0, 1_000_000],
          );
          const areaBounds = numericBounds(
            typed.map((r) => r.area),
            [0, 2_000],
          );
          const unitBounds = numericBounds(
            typed.map((r) => r.pricePerM2),
            [0, 10_000],
          );
          setBinaPriceBounds(priceBounds);
          setBinaAreaBounds(areaBounds);
          setBinaUnitBounds(unitBounds);
          setBinaPriceRange(priceBounds);
          setBinaAreaRange(areaBounds);
          setBinaUnitRange(unitBounds);
        }

        if (project === "Markets") {
          const typed = data.rows as MarketsRow[];
          setSources((data.meta?.sources as string[]) ?? []);
          setCategories((data.meta?.categories as string[]) ?? []);
          setBrands((data.meta?.brands as string[]) ?? []);
          const priceBounds = numericBounds(
            typed.map((r) => r.price),
            [0, 1_000],
          );
          setMarketsPriceBounds(priceBounds);
          setMarketsPriceRange(priceBounds);
        }

        if (project === "Turbo.az") {
          const typed = data.rows as TurboRow[];
          setBrands((data.meta?.brands as string[]) ?? []);
          setTurboBrandMode("all");
          setTurboMinAds(20);
          setTurboFuelTypes((data.meta?.fuelTypes as string[]) ?? []);
          setTurboBodyTypes((data.meta?.bodyTypes as string[]) ?? []);
          setTurboTransmissions((data.meta?.transmissions as string[]) ?? []);

          const priceBounds = numericBounds(
            typed.map((r) => r.price),
            [0, 1_000_000],
          );
          const years = typed
            .map((r) => r.year)
            .filter((v): v is number => v != null);
          const mileage = typed
            .map((r) => r.mileage)
            .filter((v): v is number => v != null);
          const yearBounds = numericBounds(years, [1970, 2026]);
          const mileageBounds = numericBounds(mileage, [0, 500_000]);

          setTurboPriceBounds(priceBounds);
          setTurboYearBounds(yearBounds);
          setTurboMileageBounds(mileageBounds);
          setTurboPriceRange(priceBounds);
          setTurboYearRange(yearBounds);
          setTurboMileageRange(mileageBounds);
        }
      } catch (err) {
        if (!isActive) return;
        const message = err instanceof Error ? err.message : I18N.en.failedLoad;
        setRows([]);
        setMeta({});
        setError(`${I18N.en.failedLoad}: ${message}`);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    run();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [project]);

  // 1. First Pass: Filter by everything EXCEPT the grouped dimension (Regions / Brands)
  // This allows us to calculate how many ads remain for EACH Region/Brand based on Date, Price, Category etc.
  const baseData = useMemo(() => {
    const periodSet = new Set(periods);

    if (project === "Bina.az") {
      const typed = rows as BinaRow[];
      const categorySet = new Set(categories);
      const roomSet = new Set(rooms);
      const rowsWithoutRegions = typed.filter((r) => {
        const okPeriod = periodSet.has(r.period);
        const okOp = r.operationType === operationType;
        const okCategory = categories.length === 0 ? true : categorySet.has(r.category);
        const okRoom =
          rooms.length === 0
            ? true
            : r.rooms !== null && roomSet.has(roomGroupLabel(r.rooms));
        const okPrice = r.price >= binaPriceRange[0] && r.price <= binaPriceRange[1];
        const okArea = r.area >= binaAreaRange[0] && r.area <= binaAreaRange[1];
        const okUnit = operationType === "Rent" ? true : r.pricePerM2 >= binaUnitRange[0] && r.pricePerM2 <= binaUnitRange[1];
        return okPeriod && okOp && okCategory && okRoom && okPrice && okArea && okUnit;
      });

      const counts = new Map<string, number>();
      for (const row of rowsWithoutRegions) {
        counts.set(row.region, (counts.get(row.region) ?? 0) + 1);
      }

      // Available regions is just the regions that have >0 ads with current active filters
      const availableRegions = [...counts.entries()]
        .sort((a, b) => b[1] - a[1]) // highest volume first
        .map(([region]) => region);

      return { rows: rowsWithoutRegions, counts, availableRegions, availableBrands: [] };
    }

    if (project === "Markets") {
      const typed = rows as MarketsRow[];
      const sourceSet = new Set(sources);
      const categorySet = new Set(categories);
      const brandSet = new Set(brands);
      const rowsFiltered = typed.filter((r) => {
        const okPeriod = periodSet.has(r.period);
        const okSource = sources.length === 0 ? true : sourceSet.has(r.source);
        const okCategory = categories.length === 0 ? true : categorySet.has(r.category);
        const okBrand = brands.length === 0 ? true : brandSet.has(r.brand);
        const okPrice = r.price >= marketsPriceRange[0] && r.price <= marketsPriceRange[1];
        return okPeriod && okSource && okCategory && okBrand && okPrice;
      });
      return { rows: rowsFiltered, counts: new Map(), availableRegions: [], availableBrands: [] };
    }

    // Turbo.az
    const typed = rows as TurboRow[];
    const fuelSet = new Set(turboFuelTypes);
    const bodySet = new Set(turboBodyTypes);
    const transmissionSet = new Set(turboTransmissions);
    const rowsWithoutBrands = typed.filter((r) => {
      const okPeriod = periodSet.has(r.period);
      const okPrice = r.price >= turboPriceRange[0] && r.price <= turboPriceRange[1];
      const okYear = r.year === null || (r.year >= turboYearRange[0] && r.year <= turboYearRange[1]);
      const okMileage = r.mileage === null || (r.mileage >= turboMileageRange[0] && r.mileage <= turboMileageRange[1]);
      const okFuel = turboFuelTypes.length === 0 ? true : fuelSet.has(r.fuelType);
      const okBody = turboBodyTypes.length === 0 ? true : bodySet.has(r.bodyType);
      const okTransmission = turboTransmissions.length === 0 ? true : transmissionSet.has(r.transmission);
      return okPeriod && okPrice && okYear && okMileage && okFuel && okBody && okTransmission;
    });

    const counts = new Map<string, number>();
    for (const row of rowsWithoutBrands) {
      counts.set(row.brand, (counts.get(row.brand) ?? 0) + 1);
    }

    const availableBrands = [...counts.entries()]
      .sort((a, b) => b[1] - a[1]) // highest volume first
      .map(([brand]) => brand);

    return { rows: rowsWithoutBrands, counts, availableRegions: [], availableBrands };
  }, [
    rows,
    project,
    periods,
    operationType,
    categories,
    rooms,
    binaPriceRange,
    binaAreaRange,
    binaUnitRange,
    sources,
    brands, // Markets uses manual brands filter completely
    marketsPriceRange,
    turboPriceRange,
    turboYearRange,
    turboMileageRange,
    turboFuelTypes,
    turboBodyTypes,
    turboTransmissions,
  ]);

  // 2. Second Pass: Apply Region / Brand rules to the baseData
  const filteredRows = useMemo(() => {
    if (project === "Bina.az") {
      const base = baseData.rows as BinaRow[];
      if (regionMode === "custom") {
        // Just slice out what the user picked. Overrides `minRegionAds`.
        const selectedSet = new Set(regions);
        return base.filter((r) => selectedSet.has(r.region));
      }

      const eligible = [...baseData.counts.entries()]
        .filter(([, count]) => count >= minRegionAds)
        .sort((a, b) => b[1] - a[1])
        .map(([region]) => region);

      const selected =
        regionMode === "all"
          ? eligible
          : regionMode === "top10"
            ? eligible.slice(0, 10)
            : eligible.slice(0, 20); // top20

      const selectedSet = new Set(selected);
      return base.filter((r) => selectedSet.has(r.region));
    }

    if (project === "Markets") {
      return baseData.rows as MarketsRow[];
    }

    // Turbo.az
    const base = baseData.rows as TurboRow[];
    if (turboBrandMode === "custom") {
      const selectedSet = new Set(brands);
      return base.filter((r) => selectedSet.has(r.brand));
    }

    const eligible = [...baseData.counts.entries()]
      .filter(([, count]) => count >= turboMinAds)
      .sort((a, b) => b[1] - a[1])
      .map(([brand]) => brand);

    const selected =
      turboBrandMode === "all"
        ? eligible
        : turboBrandMode === "top10"
          ? eligible.slice(0, 10)
          : eligible.slice(0, 20); // top20

    const selectedSet = new Set(selected);
    return base.filter((r) => selectedSet.has(r.brand));
  }, [project, baseData, regionMode, regions, minRegionAds, turboBrandMode, brands, turboMinAds]);


  const rawTrend = useMemo(() => {
    const byPeriod = new Map<string, number[]>();
    const byPeriodAndGroup = new Map<string, Map<string, number[]>>();

    if (project === "Bina.az") {
      for (const r of filteredRows as BinaRow[]) {
        const metric = operationType === "Rent" ? r.price : r.pricePerM2;
        if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
        byPeriod.get(r.period)?.push(metric);
        
        if (splitTrend && regionMode === "custom") {
          const grp = r.region;
          if (!byPeriodAndGroup.has(r.period)) byPeriodAndGroup.set(r.period, new Map());
          if (!byPeriodAndGroup.get(r.period)!.has(grp)) byPeriodAndGroup.get(r.period)!.set(grp, []);
          byPeriodAndGroup.get(r.period)!.get(grp)!.push(metric);
        }
      }
    } else if (project === "Markets") {
      for (const r of filteredRows as MarketsRow[]) {
        if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
        byPeriod.get(r.period)?.push(r.price);
      }
    } else {
      for (const r of filteredRows as TurboRow[]) {
        if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
        byPeriod.get(r.period)?.push(r.price);
        
        if (splitTrend && turboBrandMode === "custom") {
          const grp = r.brand;
          if (!byPeriodAndGroup.has(r.period)) byPeriodAndGroup.set(r.period, new Map());
          if (!byPeriodAndGroup.get(r.period)!.has(grp)) byPeriodAndGroup.get(r.period)!.set(grp, []);
          byPeriodAndGroup.get(r.period)!.get(grp)!.push(r.price);
        }
      }
    }

    const points = [...byPeriod.entries()]
      .sort(([a], [b]) => periodCompare(a, b))
      .map(([period, values]) => {
        const base: Record<string, string | number> = {
          period,
          dateLabel: periodToLabel(period, dateLocale),
          medianPrice: median(values),
        };
        const grpMap = byPeriodAndGroup.get(period);
        if (grpMap) {
          for (const [grp, grpVals] of grpMap.entries()) {
            base[grp] = median(grpVals);
          }
        }
        return base as TrendDatum;
      });

    return withPercentChange(points, {
      noPreviousPeriod: t("noPreviousPeriod"),
      drop: t("drop"),
      rise: t("rise"),
      noChange: t("noChange"),
    });
  }, [filteredRows, project, operationType, dateLocale, splitTrend, regionMode, turboBrandMode, t]);

  const canSplitTrend = (project === "Bina.az" && regionMode === "custom" && regions.length > 0) || (project === "Turbo.az" && turboBrandMode === "custom" && brands.length > 0);
  const trendGroups = useMemo(
    () => (canSplitTrend ? (project === "Bina.az" ? regions : brands) : []),
    [canSplitTrend, project, regions, brands],
  );

  const useSummaryView = Boolean(summary && rows.length === 0 && activeFilterCount === 0);
  const summaryTrend = useMemo(
    () => {
      if (!summary) return [];
      const points = summary.defaultView.trend
        .sort((a, b) => periodCompare(a.period, b.period))
        .map((point) => ({
          period: point.period,
          dateLabel: periodToLabel(point.period, dateLocale),
          medianPrice: point.medianPrice,
        }));
      return withPercentChange(points, {
        noPreviousPeriod: t("noPreviousPeriod"),
        drop: t("drop"),
        rise: t("rise"),
        noChange: t("noChange"),
      });
    },
    [summary, dateLocale, t],
  );
  const trend = useSummaryView ? summaryTrend : rawTrend;

  const rawListingCountTrend = useMemo<ListingCountPoint[]>(() => {
    const byPeriod = new Map<string, number>();
    const byPeriodAndGroup = new Map<string, Map<string, number>>();

    for (const row of filteredRows as AnyRow[]) {
      byPeriod.set(row.period, (byPeriod.get(row.period) ?? 0) + 1);

      // Handle split lines by group (region or brand)
      if (splitTrend && canSplitTrend) {
        const groupValue = 
          project === "Bina.az" ? (row as BinaRow).region :
          project === "Turbo.az" ? (row as TurboRow).brand :
          "";
        
        if (groupValue) {
          if (!byPeriodAndGroup.has(row.period)) {
            byPeriodAndGroup.set(row.period, new Map());
          }
          const grpMap = byPeriodAndGroup.get(row.period)!;
          grpMap.set(groupValue, (grpMap.get(groupValue) ?? 0) + 1);
        }
      }
    }

    const points = [...byPeriod.entries()]
      .sort(([a], [b]) => periodCompare(a, b))
      .map(([period, count]) => {
        const base: Record<string, string | number> = {
          period,
          dateLabel: periodToLabel(period, dateLocale),
          count,
        };
        const grpMap = byPeriodAndGroup.get(period);
        if (grpMap) {
          for (const [grp, grpCount] of grpMap.entries()) {
            base[grp] = grpCount;
          }
        }
        return base as ListingCountBasePoint;
      });

    // Add percent change for listing count
    if (points.length === 0) return [];
    const baseCount = points[0].count;

    return points.map((point, idx) => {
      if (idx === 0 || !baseCount) {
        return { ...point, pctChange: 0, pctLabel: t("noPreviousPeriod") };
      }
      const value = ((point.count - baseCount) / baseCount) * 100;
      const dir = value < 0 ? t("drop") : value > 0 ? t("rise") : t("noChange");
      const label = `${Math.abs(value).toFixed(2)}% ${dir}`;
      return { ...point, pctChange: value, pctLabel: label };
    });
  }, [filteredRows, dateLocale, splitTrend, canSplitTrend, project, t]);

  const summaryListingCountTrend = useMemo<ListingCountPoint[]>(() => {
    if (!summary) return [];
    const points = summary.defaultView.trend
      .sort((a, b) => periodCompare(a.period, b.period))
      .map((point) => ({
        period: point.period,
        dateLabel: periodToLabel(point.period, dateLocale),
        count: point.count,
      }));
    if (points.length === 0) return [];
    const baseCount = points[0].count;
    return points.map((point, idx) => {
      if (idx === 0 || !baseCount) {
        return { ...point, pctChange: 0, pctLabel: t("noPreviousPeriod") };
      }
      const value = ((point.count - baseCount) / baseCount) * 100;
      const dir = value < 0 ? t("drop") : value > 0 ? t("rise") : t("noChange");
      return {
        ...point,
        pctChange: value,
        pctLabel: `${Math.abs(value).toFixed(2)}% ${dir}`,
      };
    });
  }, [summary, dateLocale, t]);
  const listingCountTrend = useSummaryView ? summaryListingCountTrend : rawListingCountTrend;

  const priceFractionDigits = project === "Markets" ? 2 : 0;

  const kpis = useMemo(() => {
  const sorted = [...trend].sort((a, b) => periodCompare(b.period, a.period));
    const latest = sorted[0];
    const prevs = sorted.slice(1, 4); // Take up to 3 previous periods

    return {
      count: useSummaryView ? (summary?.defaultView.count ?? 0) : filteredRows.length,
      medianValue: latest?.medianPrice ?? 0,
      latestPct: latest?.pctChange ?? 0,
      latestLabel: latest?.dateLabel ?? "",
      history: prevs.map((p) => ({
        label: p.dateLabel,
        value: fmtFixed(p.medianPrice, priceFractionDigits),
      })),
      historyPct: prevs.map((p) => ({
        label: p.dateLabel,
        value: `${p.pctChange > 0 ? "+" : ""}${p.pctChange.toFixed(1)}%`,
        accent: (p.pctChange > 0
          ? "green"
          : p.pctChange < 0
            ? "red"
            : "neutral") as "green" | "red" | "neutral",
      })),
    };
  }, [filteredRows, priceFractionDigits, trend, useSummaryView, summary]);

  const medianLabel =
    project === "Bina.az" && operationType === "Sale"
      ? t("medianPriceM2")
      : t("medianPrice");

  const priceTrendDomain = useMemo(
    () => {
      const allValues = trend.flatMap((point) => {
        const vals = [point.medianPrice];
        if (splitTrend) {
          for (const group of trendGroups) {
            const v = (point as TrendDatum)[group];
            if (typeof v === "number") vals.push(v);
          }
        }
        return vals;
      });
      return buildChartDomain(
        allValues,
        {
          paddingRatio: 0.14,
          minPadding: project === "Bina.az" && operationType === "Sale" ? 10 : 100,
          clampMin: 0,
        },
      );
    },
    [trend, project, operationType, splitTrend, trendGroups],
  );

  const listingCountDomain = useMemo(
    () =>
      buildChartDomain(
        listingCountTrend.map((point) => point.count),
        {
          paddingRatio: 0.15,
          minPadding: 1,
          clampMin: 0,
        },
      ),
    [listingCountTrend],
  );

  const percentTrendDomain = useMemo(
    () =>
      buildChartDomain(
        trend.map((point) => point.pctChange),
        {
          paddingRatio: 0.18,
          minPadding: 0.5,
          includeValues: [0],
        },
      ),
    [trend],
  );

  const listingCountPctChangeDomain = useMemo(
    () =>
      buildChartDomain(
        listingCountTrend.map((point) => point.pctChange),
        {
          paddingRatio: 0.18,
          minPadding: 0.5,
          includeValues: [0],
        },
      ),
    [listingCountTrend],
  );

  const rawBreakdownData = useMemo<BreakdownPoint[]>(() => {
    const getBreakdownKey = (row: AnyRow) => {
      if (project === "Bina.az") {
        const r = row as BinaRow;
        if (breakdownDimBina === "rooms") return roomGroupLabel(r.rooms);
        if (breakdownDimBina === "region") return r.region;
        return r.category;
      }
      if (project === "Markets") {
        const r = row as MarketsRow;
        if (breakdownDimMarkets === "source") return r.source;
        if (breakdownDimMarkets === "category") return r.category;
        return r.brand;
      }
      const r = row as TurboRow;
      if (breakdownDimTurbo === "fuelType") return r.fuelType;
      if (breakdownDimTurbo === "bodyType") return r.bodyType;
      return r.transmission;
    };
    const getBreakdownMetric = (row: AnyRow) => {
      if (project === "Bina.az") {
        const r = row as BinaRow;
        return operationType === "Sale" ? r.pricePerM2 : r.price;
      }
      return (row as MarketsRow | TurboRow).price;
    };
    const makePoint = (
      key: string,
      values: number[],
      period?: string,
    ): BreakdownPoint => {
      const medianValue = median(values);
      const medianPrice =
        project === "Markets"
          ? Number(medianValue.toFixed(2))
          : Math.round(medianValue);
      const labelKey = period ? `${periodToLabel(period, dateLocale)}: ${key}` : key;
      return {
        key: labelKey,
        medianPrice,
        count: values.length,
        valueLabel: `${fmtFixed(medianPrice, priceFractionDigits)} / ${fmtNum(
          values.length,
        )}`,
        period,
        dateLabel: period ? periodToLabel(period, dateLocale) : undefined,
      };
    };

    if (breakdownMode === "monthly") {
      const map = new Map<string, { period: string; key: string; values: number[] }>();
      for (const row of filteredRows) {
        const key = getBreakdownKey(row);
        const id = `${row.period}\u0000${key}`;
        const bucket = map.get(id) ?? { period: row.period, key, values: [] };
        bucket.values.push(getBreakdownMetric(row));
        map.set(id, bucket);
      }

      return [...map.values()]
        .map((bucket) => makePoint(bucket.key, bucket.values, bucket.period))
        .filter((d) => d.count >= 5)
        .sort((a, b) => {
          const periodOrder = periodCompare(a.period ?? "", b.period ?? "");
          if (periodOrder !== 0) return periodOrder;
          return b.medianPrice - a.medianPrice;
        })
        .slice(0, 60);
    }

    const map = new Map<string, number[]>();
    for (const r of filteredRows) {
      const key = getBreakdownKey(r);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(getBreakdownMetric(r));
    }
    return [...map.entries()]
      .map(([key, values]) => makePoint(key, values))
      .filter((d) => d.count >= 5)
      .sort((a, b) => b.medianPrice - a.medianPrice)
      .slice(0, 20);
  }, [
    filteredRows,
    project,
    operationType,
    breakdownDimBina,
    breakdownDimMarkets,
    breakdownDimTurbo,
    breakdownMode,
    dateLocale,
    priceFractionDigits,
  ]);

  const breakdownDimLabel =
    project === "Bina.az"
      ? {
          rooms: t("byRooms"),
          region: t("byRegion"),
          category: t("byCategory"),
        }[breakdownDimBina]
      : project === "Markets"
        ? {
            source: t("bySource"),
            category: t("byCategory"),
            brand: t("byBrand"),
          }[breakdownDimMarkets]
        : {
            fuelType: t("byFuelType"),
            bodyType: t("byBodyType"),
            transmission: t("byTransmission"),
          }[breakdownDimTurbo];

  const summaryBreakdownData = useMemo<BreakdownPoint[]>(() => {
    if (!summary) return [];
    const dim =
      project === "Bina.az"
        ? breakdownDimBina
        : project === "Markets"
          ? breakdownDimMarkets
          : breakdownDimTurbo;
    const mode = breakdownMode === "monthly" ? "monthly" : "aggregate";
    const points = summary.defaultView.breakdowns[mode][dim] ?? [];
    return points.map((point: SummaryBreakdownPoint) => {
      const medianPrice =
        project === "Markets"
          ? Number(point.medianPrice.toFixed(2))
          : Math.round(point.medianPrice);
      const key = point.period
        ? `${periodToLabel(point.period, dateLocale)}: ${point.key}`
        : point.key;
      return {
        key,
        medianPrice,
        count: point.count,
        valueLabel: `${fmtFixed(medianPrice, priceFractionDigits)} / ${fmtNum(
          point.count,
        )}`,
        period: point.period,
        dateLabel: point.period ? periodToLabel(point.period, dateLocale) : undefined,
      };
    });
  }, [
    summary,
    project,
    breakdownDimBina,
    breakdownDimMarkets,
    breakdownDimTurbo,
    breakdownMode,
    dateLocale,
    priceFractionDigits,
  ]);
  const breakdownData = useSummaryView ? summaryBreakdownData : rawBreakdownData;

  const insights = useMemo<Insight[]>(() => {
    if (useSummaryView) return [];
    const result: Insight[] = [];
    const isAz = lang === "az";
    const latestPrice = trend.at(-1);
    const previousPrice = trend.at(-2);
    const earliestPrice = trend[0];
    const latestCount = listingCountTrend.at(-1);
    const previousCount = listingCountTrend.at(-2);

    type SegmentMove = {
      dim: string;
      key: string;
      change: number;
      previousMedian: number;
      latestMedian: number;
      previousCount: number;
      latestCount: number;
      shareDelta: number;
    };

    const metric = (row: AnyRow) => {
      if (project === "Bina.az") {
        const r = row as BinaRow;
        return operationType === "Sale" ? r.pricePerM2 : r.price;
      }
      return (row as MarketsRow | TurboRow).price;
    };
    const segmentKey = (row: AnyRow, dim: string) => {
      if (project === "Bina.az") {
        const r = row as BinaRow;
        if (dim === "rooms")
          return roomGroupLabel(r.rooms);
        if (dim === "region") return r.region;
        return r.category;
      }
      if (project === "Markets") {
        const r = row as MarketsRow;
        if (dim === "source") return r.source;
        if (dim === "category") return r.category;
        return r.brand;
      }
      const r = row as TurboRow;
      if (dim === "fuelType") return r.fuelType;
      if (dim === "bodyType") return r.bodyType;
      if (dim === "transmission") return r.transmission;
      return r.brand;
    };
    const dims =
      project === "Bina.az"
        ? [
            { id: "region", label: t("byRegion") },
            { id: "category", label: t("byCategory") },
            { id: "rooms", label: t("byRooms") },
          ]
        : project === "Markets"
          ? [
              { id: "category", label: t("byCategory") },
              { id: "brand", label: t("byBrand") },
              { id: "source", label: t("bySource") },
            ]
          : [
              { id: "brand", label: t("byBrand") },
              { id: "fuelType", label: t("byFuelType") },
              { id: "bodyType", label: t("byBodyType") },
              { id: "transmission", label: t("byTransmission") },
            ];
    const fmtMetric = (value: number) => fmtFixed(value, priceFractionDigits);
    const vs = (current: number, previous: number) =>
      previous ? ((current - previous) / previous) * 100 : 0;
    const sample = (count: number) => (isAz ? `n=${fmtNum(count)}` : `n=${fmtNum(count)}`);
    const reliableRows = (total: number) =>
      Math.max(project === "Markets" ? 50 : 100, Math.ceil(total * 0.002));

    if (latestPrice && previousPrice && latestCount && previousCount) {
      const priceChange = vs(latestPrice.medianPrice, previousPrice.medianPrice);
      const supplyChange = vs(latestCount.count, previousCount.count);
      const marketRead = isAz
        ? priceChange > 0 && supplyChange < 0
          ? "Elan sayı azalıb, qiymət artıb: bazar sıxlaşıb, satıcı tərəfdə qiymət təzyiqi güclənib."
          : priceChange > 0 && supplyChange > 0
            ? "Elan sayı artsa da qiymət qalxıb: tələb və ya satıcı gözləntisi hələ güclüdür."
            : priceChange < 0 && supplyChange > 0
              ? "Elan sayı artıb, qiymət düşüb: bazar yumşalıb, alıcı seçimi genişlənib."
              : priceChange < 0 && supplyChange < 0
                ? "Elan sayı və qiymət birlikdə düşüb: bazar aktivliyi zəifləyib, qiymət təzyiqi azalıb."
                : "Bazar əsasən stabil qalıb: son dövrdə güclü elan-qiymət siqnalı görünmür."
        : priceChange > 0 && supplyChange < 0
          ? "Supply fell while prices rose: tighter market, stronger seller/ask pressure."
          : priceChange > 0 && supplyChange > 0
            ? "Prices rose even with more listings: demand or asking expectations stayed firm."
            : priceChange < 0 && supplyChange > 0
              ? "Supply expanded while prices fell: softer market, more buyer choice."
              : priceChange < 0 && supplyChange < 0
                ? "Listings and prices both fell: thinner activity, cooling price pressure."
                : "Market moved sideways: no strong supply-price signal in latest period.";
      result.push({
        text: isAz
          ? `${marketRead} ${latestPrice.dateLabel} vs ${previousPrice.dateLabel}: ${medianLabel} ${fmtSignedPercent(
              priceChange,
            )}, elan sayı ${fmtSignedPercent(supplyChange)}.`
          : `${marketRead} ${latestPrice.dateLabel} vs ${previousPrice.dateLabel}: ${medianLabel} ${fmtSignedPercent(
              priceChange,
            )}, listings ${fmtSignedPercent(supplyChange)}.`,
        tone:
          priceChange > 0 && supplyChange < 0
            ? "amber"
            : priceChange < 0 && supplyChange > 0
              ? "blue"
              : priceChange > 0
                ? "green"
                : priceChange < 0
                  ? "red"
                  : "neutral",
      });
    }

    if (latestPrice && earliestPrice && latestCount) {
      result.push({
        text: isAz
          ? `Seçilmiş dövr trendi: median ${earliestPrice.dateLabel}-dən bəri ${fmtSignedPercent(
              latestPrice.pctChange,
            )} dəyişib, indi ${fmtMetric(
              latestPrice.medianPrice,
            )}; son nümunə ${fmtNum(latestCount.count)} elandır.`
          : `Selected-period trend: median moved ${fmtSignedPercent(
              latestPrice.pctChange,
            )} since ${earliestPrice.dateLabel}, now ${fmtMetric(
              latestPrice.medianPrice,
            )}; latest sample is ${fmtNum(latestCount.count)} listings.`,
        tone:
          latestPrice.pctChange > 0
            ? "green"
            : latestPrice.pctChange < 0
              ? "red"
              : "neutral",
      });
    }

    const allMoves: SegmentMove[] = [];
    if (latestPrice && previousPrice && latestCount && previousCount) {
      const minSegmentRows = reliableRows(Math.min(latestCount.count, previousCount.count));
      const periodsToCompare = [previousPrice.period, latestPrice.period];

      for (const dim of dims) {
        const byPeriodAndSegment = new Map<string, Map<string, number[]>>();

        for (const row of filteredRows) {
          if (!periodsToCompare.includes(row.period)) continue;
          const periodMap =
            byPeriodAndSegment.get(row.period) ?? new Map<string, number[]>();
          const key = segmentKey(row, dim.id);
          const values = periodMap.get(key) ?? [];
          values.push(metric(row));
          periodMap.set(key, values);
          byPeriodAndSegment.set(row.period, periodMap);
        }

        const previousSegments =
          byPeriodAndSegment.get(previousPrice.period) ?? new Map();
        const latestSegments =
          byPeriodAndSegment.get(latestPrice.period) ?? new Map();

        for (const [key, latestValues] of latestSegments.entries()) {
          const previousValues = previousSegments.get(key) ?? [];
          if (
            latestValues.length < minSegmentRows ||
            previousValues.length < minSegmentRows
          ) {
            continue;
          }
          const latestMedian = median(latestValues);
          const previousMedian = median(previousValues);
          allMoves.push({
            dim: dim.label,
            key,
            change: vs(latestMedian, previousMedian),
            previousMedian,
            latestMedian,
            latestCount: latestValues.length,
            previousCount: previousValues.length,
            shareDelta:
              (latestValues.length / latestCount.count -
                previousValues.length / previousCount.count) *
              100,
          });
        }
      }

      const strongest = [...allMoves].sort((a, b) => b.change - a.change)[0];
      const weakest = [...allMoves].sort((a, b) => a.change - b.change)[0];
      if (strongest && weakest) {
        result.push({
          text: isAz
            ? `Seqment təzyiqi: etibarlı nümunələr içində ən sürətli qiymət artımı ${strongest.key} (${strongest.dim}) üzrədir: ${fmtSignedPercent(
                strongest.change,
              )}; ${fmtMetric(strongest.previousMedian)} -> ${fmtMetric(
                strongest.latestMedian,
              )}. Elan sayı ${fmtNum(strongest.previousCount)} -> ${fmtNum(
                strongest.latestCount,
              )}. Ən zəif seqment: ${weakest.key} (${weakest.dim}) ${fmtSignedPercent(
                weakest.change,
              )}.`
            : `Price pressure by segment: fastest increase is ${strongest.key} (${strongest.dim}) ${fmtSignedPercent(
                strongest.change,
              )}, ${fmtMetric(strongest.previousMedian)} -> ${fmtMetric(
                strongest.latestMedian,
              )}; weakest is ${weakest.key} (${weakest.dim}) ${fmtSignedPercent(
                weakest.change,
              )}.`,
          tone: strongest.change > Math.abs(weakest.change) ? "green" : "blue",
        });
      }

      const shareGainer = [...allMoves].sort(
        (a, b) => b.shareDelta - a.shareDelta,
      )[0];
      const shareLoser = [...allMoves].sort(
        (a, b) => a.shareDelta - b.shareDelta,
      )[0];
      if (shareGainer && shareLoser) {
        result.push({
          text: isAz
            ? `Elan strukturu ${shareGainer.key} (${shareGainer.dim}) tərəfə dəyişib: pay ${shareGainer.shareDelta.toFixed(
                1,
              )} faiz bəndi artıb. ${shareLoser.key} (${shareLoser.dim}) pay itirib: ${shareLoser.shareDelta.toFixed(
                1,
              )} faiz bəndi.`
            : `Listing mix shifted toward ${shareGainer.key} (${shareGainer.dim}, ${shareGainer.shareDelta.toFixed(
                1,
              )} pp share) and away from ${shareLoser.key} (${shareLoser.dim}, ${shareLoser.shareDelta.toFixed(
                1,
              )} pp).`,
          tone: "blue",
        });
      }
    }

    if (breakdownData.length > 0) {
      const insightBreakdown = latestCount
        ? breakdownData.filter((item) => item.count >= reliableRows(latestCount.count))
        : breakdownData;
      const highest = insightBreakdown[0];
      const lowest = insightBreakdown.at(-1);
      if (!highest) {
        result.push({
          text: isAz
            ? `${breakdownDimLabel} üzrə qiymət fərqi üçün kifayət qədər böyük seqment nümunəsi yoxdur. Kiçik qruplar qrafikdə görünə bilər, amma insight üçün istifadə olunmur.`
            : `No large enough segment sample for a reliable ${breakdownDimLabel} price gap. Small groups may still appear in the chart, but are excluded from insights.`,
          tone: "amber",
        });
      } else {
      const premium =
        lowest && lowest.medianPrice > 0
          ? vs(highest.medianPrice, lowest.medianPrice)
          : 0;
      result.push({
        text:
          lowest && highest.key !== lowest.key
            ? isAz
              ? `Cari qiymət fərqi: etibarlı nümunələrdə ${highest.key} (${breakdownDimLabel}) ən yüksək median qiymətə malikdir: ${fmtMetric(
                  highest.medianPrice,
                )} (${sample(highest.count)}). ${lowest.key} ən aşağıdır: ${fmtMetric(
                  lowest.medianPrice,
                )} (${sample(lowest.count)}). Fərq: ${fmtSignedPercent(premium)}.`
              : `Current price gap: ${highest.key} is highest visible ${breakdownDimLabel}, ${fmtMetric(
                  highest.medianPrice,
                )} (${sample(highest.count)}); ${lowest.key} is lowest, ${fmtMetric(
                  lowest.medianPrice,
                )} (${sample(lowest.count)}). Gap: ${fmtSignedPercent(premium)}.`
            : isAz
              ? `Cari ${breakdownDimLabel} üzrə əsas median: ${highest.key}, ${fmtMetric(
                  highest.medianPrice,
                )} (${sample(highest.count)}).`
              : `Current ${breakdownDimLabel} median: ${highest.key}, ${fmtMetric(
                  highest.medianPrice,
                )} (${sample(highest.count)}).`,
        tone: "neutral",
      });
      }
    }

    if (latestPrice) {
      const latestRows = filteredRows.filter((row) => row.period === latestPrice.period);
      const concentration = dims
        .map((dim) => {
          const counts = new Map<string, number>();
          for (const row of latestRows) {
            const key = segmentKey(row, dim.id);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
          if (!top || latestRows.length === 0) return null;
          return {
            dim: dim.label,
            key: top[0],
            count: top[1],
            share: (top[1] / latestRows.length) * 100,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.share - a.share)[0];

      if (concentration) {
        result.push({
        text: isAz
          ? `Bazar konsentrasiyası: son dövrdə elanların ${concentration.share.toFixed(
              1,
            )}%-i ${concentration.key} (${concentration.dim}) seqmentindədir (${fmtNum(
                concentration.count,
              )} elan). Bu, ümumi medianın həmin seqmentdən güclü təsirləndiyini göstərir.`
            : `Market concentration: ${concentration.key} (${concentration.dim}) holds ${concentration.share.toFixed(
                1,
              )}% of latest listings (${fmtNum(concentration.count)} ads).`,
          tone: concentration.share >= 35 ? "amber" : "neutral",
        });
      }
    }

    if (trend.length >= 3) {
      const periodMoves = trend
        .slice(1)
        .map((point, idx) => vs(point.medianPrice, trend[idx].medianPrice));
      const averageAbsMove =
        periodMoves.reduce((sum, value) => sum + Math.abs(value), 0) /
        periodMoves.length;
      const directionChanges = periodMoves.filter(
        (value, idx) => idx > 0 && Math.sign(value) !== Math.sign(periodMoves[idx - 1]),
      ).length;
      result.push({
        text: isAz
          ? `Qiymət volatilliyi: dövrlərarası orta dəyişmə ${averageAbsMove.toFixed(
              1,
            )}%-dir; trend ${directionChanges > 0 ? `${directionChanges} dəfə istiqamət dəyişib` : "eyni istiqamətdə davam edib"}.`
          : `Price volatility: average period-to-period move is ${averageAbsMove.toFixed(
              1,
            )}%; trend ${directionChanges > 0 ? `changed direction ${directionChanges} time(s)` : "kept one direction"}.`,
        tone: averageAbsMove >= 5 ? "amber" : "neutral",
      });
    }

    if (allMoves.length > 0) {
      const broadRisers = allMoves.filter((move) => move.change > 0).length;
      const breadth = (broadRisers / allMoves.length) * 100;
      result.push({
        text: isAz
          ? `Artımın yayılması: kifayət qədər elan sayı olan seqmentlərin ${breadth.toFixed(
              0,
            )}%-də median qiymət son dövrə qarşı artıb (${broadRisers}/${allMoves.length}).`
          : `Breadth of increase: ${breadth.toFixed(
              0,
            )}% of reliable segments have higher median price than previous period (${broadRisers}/${allMoves.length}).`,
        tone: breadth >= 60 ? "green" : breadth <= 40 ? "red" : "neutral",
      });
    }

    if (filteredRows.length < 1_000) {
      result.push({
        text: isAz
          ? `Kiçik nümunə: ${fmtNum(
              filteredRows.length,
            )} sətir. Seqment nəticələrini istiqamət kimi oxu, qəti nəticə kimi yox.`
          : `Small filtered sample: ${fmtNum(
              filteredRows.length,
            )} rows. Treat segment changes as directional, not definitive.`,
        tone: "amber",
      });
    }

    return result.slice(0, 8);
  }, [
    trend,
    listingCountTrend,
    breakdownData,
    breakdownDimLabel,
    filteredRows,
    lang,
    medianLabel,
    operationType,
    priceFractionDigits,
    project,
    useSummaryView,
    t,
  ]);

  const analysisContext = useMemo<AnalysisContext>(() => {
    const commonFilters: Record<string, unknown> = {
      periods,
      activeFilterCount,
    };

    const filters =
      project === "Bina.az"
        ? {
            ...commonFilters,
            operationType,
            regionMode,
            minRegionAds,
            selectedRegions: regionMode === "custom" ? regions : undefined,
            categories,
            rooms,
            priceRange: binaPriceRange,
            areaRange: binaAreaRange,
            unitPriceRange: operationType === "Sale" ? binaUnitRange : undefined,
          }
        : project === "Markets"
          ? {
              ...commonFilters,
              sources,
              categories,
              brands,
              priceRange: marketsPriceRange,
            }
          : {
              ...commonFilters,
              brandMode: turboBrandMode,
              minBrandAds: turboMinAds,
              selectedBrands: turboBrandMode === "custom" ? brands : undefined,
              fuelTypes: turboFuelTypes,
              bodyTypes: turboBodyTypes,
              transmissions: turboTransmissions,
              priceRange: turboPriceRange,
              yearRange: turboYearRange,
              mileageRange: turboMileageRange,
            };

    return {
      project,
      language: lang,
      filters,
      metrics: {
        filteredRows: kpis.count,
        medianLabel,
        latestMedian: kpis.medianValue,
        latestPercentChange: kpis.latestPct,
        latestPeriod: kpis.latestLabel,
        usingSummaryView: useSummaryView,
        loadedRows: rows.length,
      },
      trends: {
        price: trend.slice(-8),
        listings: listingCountTrend.slice(-8),
      },
      breakdown: {
        dimension: breakdownDimLabel,
        mode: breakdownMode,
        points: breakdownData.slice(0, 12),
      },
      insights: insights.map((insight) => insight.text),
    };
  }, [
    activeFilterCount,
    periods,
    project,
    lang,
    operationType,
    regionMode,
    minRegionAds,
    regions,
    categories,
    rooms,
    binaPriceRange,
    binaAreaRange,
    binaUnitRange,
    sources,
    brands,
    marketsPriceRange,
    turboBrandMode,
    turboMinAds,
    turboFuelTypes,
    turboBodyTypes,
    turboTransmissions,
    turboPriceRange,
    turboYearRange,
    turboMileageRange,
    kpis,
    medianLabel,
    useSummaryView,
    rows.length,
    trend,
    listingCountTrend,
    breakdownDimLabel,
    breakdownMode,
    breakdownData,
    insights,
  ]);

  const projects: { key: ProjectKey; icon: string }[] = [
    { key: "Bina.az", icon: "🏠" },
    { key: "Markets", icon: "🛒" },
    { key: "Turbo.az", icon: "🚗" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-zinc-900 dark:from-zinc-950 dark:via-zinc-950 dark:to-black dark:text-zinc-100">
      {/* Top navbar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/90 dark:supports-[backdrop-filter]:bg-zinc-950/70">
        <span className="text-sm font-semibold tracking-tight text-zinc-700 dark:text-zinc-200">
          {t("marketAnalytics")}
        </span>
        <nav className="flex gap-1">
          {projects.map(({ key, icon }) => (
            <button
              key={key}
              onClick={() => setProject(key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                project === key
                  ? "bg-slate-200 text-zinc-900 shadow dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <span>{icon}</span>
              {key}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-xs">
          <PillToggle
            options={[
              { label: "EN", value: "en" },
              { label: "AZ", value: "az" },
            ]}
            value={lang}
            onChange={(value) => setLang(value as Lang)}
          />
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(isLight ? "dark" : "light")}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 text-zinc-500 transition hover:border-slate-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
            title={isLight ? t("darkMode") : t("lightMode")}
          >
            {isLight ? (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
                />
              </svg>
            ) : (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-5.66l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 7a5 5 0 100 10A5 5 0 0012 7z"
                />
              </svg>
            )}
          </button>
          {loading ? (
            <span className="animate-pulse text-blue-400">{t("loading")}</span>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-600">
              {filteredRows.length.toLocaleString()} {t("rows")}
            </span>
          )}
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="sticky top-14 h-[calc(100vh-3.5rem)] w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/95 p-5 dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t("filters")}
              {activeFilterCount > 0 && (
                <span className="ml-2 inline-block rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-bold leading-none text-white">
                  {activeFilterCount}
                </span>
              )}
            </span>
            <button
              onClick={resetCurrentProjectFilters}
              disabled={activeFilterCount === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-slate-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-100"
            >
              {t("reset")}
            </button>
          </div>
          <div className="space-y-6">
            <FilterSection title={t("months")}>
              <MonthChips
                options={(meta.periods as string[]) ?? []}
                value={periods}
                onChange={setPeriods}
                locale={dateLocale}
              />
            </FilterSection>

            {project === "Bina.az" && (
              <>
                <FilterSection title={t("operation")}>
                  <PillToggle
                    options={[
                      { label: "Sale", value: "Sale" },
                      { label: "Rent", value: "Rent" },
                    ]}
                    value={operationType}
                    onChange={(v) => setOperationType(v as "Sale" | "Rent")}
                  />
                </FilterSection>
                <FilterSection title={t("regionRules")}>
                  <PillToggle
                    options={[
                      { label: t("all"), value: "all" },
                      { label: t("top10"), value: "top10" },
                      { label: t("top20"), value: "top20" },
                      { label: t("custom"), value: "custom" },
                    ]}
                    value={regionMode}
                    onChange={(v) => setRegionMode(v as RegionMode)}
                  />
                  {regionMode !== "custom" && (
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={minRegionAds}
                      onChange={(e) => setMinRegionAds(Math.max(1, Number(e.target.value) || 1))}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-100/60 px-3 py-2 text-xs text-zinc-700 outline-none focus:border-slate-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200 dark:focus:border-zinc-500"
                      placeholder={t("minAdsRegion")}
                    />
                  )}
                  {regionMode === "custom" && (
                    <div className="mt-3">
                      <CheckboxList label={t("regions")} options={baseData.availableRegions} value={regions} onChange={setRegions} ui={checkboxUi} />
                    </div>
                  )}
                </FilterSection>
                <FilterSection title={t("categories")}>
                  <CheckboxList
                    label={t("categories")}
                    options={(meta.categories as string[]) ?? []}
                    value={categories}
                    onChange={setCategories}
                    ui={checkboxUi}
                  />
                </FilterSection>
                <FilterSection title={t("rooms")}>
                  <div className="flex flex-wrap gap-2">
                    {allRooms.map((r) => (
                      <button
                        key={r}
                        onClick={() =>
                          setRooms(
                            rooms.includes(r)
                              ? rooms.filter((x) => x !== r)
                              : [...rooms, r],
                          )
                        }
                        className={`h-8 min-w-8 rounded-full border px-2 text-xs font-semibold transition-all ${
                          rooms.includes(r)
                            ? "border-blue-500 bg-blue-500/20 text-blue-600 dark:text-blue-300"
                            : "border-slate-300 bg-slate-100/50 text-zinc-500 hover:border-slate-400 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:border-zinc-500"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </FilterSection>
                <FilterSection title={t("priceRange")}>
                  <NumberRangeFilter
                    value={binaPriceRange}
                    bounds={binaPriceBounds}
                    onChange={setBinaPriceRange}
                  />
                </FilterSection>
                <FilterSection title={t("areaRange")}>
                  <NumberRangeFilter
                    value={binaAreaRange}
                    bounds={binaAreaBounds}
                    onChange={setBinaAreaRange}
                  />
                </FilterSection>
                {operationType === "Sale" && (
                  <FilterSection title={t("unitPriceRange")}>
                    <NumberRangeFilter
                      value={binaUnitRange}
                      bounds={binaUnitBounds}
                      onChange={setBinaUnitRange}
                    />
                  </FilterSection>
                )}
              </>
            )}

            {project === "Markets" && (
              <>
                <FilterSection title={t("sources")}>
                  <SourcePills
                    options={(meta.sources as string[]) ?? []}
                    value={sources}
                    onChange={setSources}
                  />
                </FilterSection>
                <FilterSection title={t("categories")}>
                  <CheckboxList
                    label={t("categories")}
                    options={(meta.categories as string[]) ?? []}
                    value={categories}
                    onChange={setCategories}
                    ui={checkboxUi}
                  />
                </FilterSection>
                <FilterSection title={t("brands")}>
                  <CheckboxList
                    label={t("brands")}
                    options={(meta.brands as string[]) ?? []}
                    value={brands}
                    onChange={setBrands}
                    ui={checkboxUi}
                  />
                </FilterSection>
                <FilterSection title={t("priceRange")}>
                  <NumberRangeFilter
                    value={marketsPriceRange}
                    bounds={marketsPriceBounds}
                    onChange={setMarketsPriceRange}
                    step={0.1}
                  />
                </FilterSection>
              </>
            )}

            {project === "Turbo.az" && (
              <>
                <FilterSection title={t("brandRules")}>
                  <PillToggle
                    options={[
                      { label: t("all"), value: "all" },
                      { label: t("top10"), value: "top10" },
                      { label: t("top20"), value: "top20" },
                      { label: t("custom"), value: "custom" },
                    ]}
                    value={turboBrandMode}
                    onChange={(v) => setTurboBrandMode(v as BrandMode)}
                  />
                  {turboBrandMode !== "custom" && (
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={turboMinAds}
                      onChange={(e) =>
                        setTurboMinAds(Math.max(1, Number(e.target.value) || 1))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-100/60 px-3 py-2 text-xs text-zinc-700 outline-none focus:border-slate-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200 dark:focus:border-zinc-500"
                      placeholder={t("minAdsBrand")}
                    />
                  )}
                  {turboBrandMode === "custom" && (
                    <div className="mt-3">
                      <CheckboxList
                        label={t("brands")}
                        options={baseData.availableBrands}
                        value={brands}
                        onChange={setBrands}
                        ui={checkboxUi}
                      />
                    </div>
                  )}
                </FilterSection>
                <FilterSection title={t("fuelTypes")}>
                  <CheckboxList
                    label={t("fuelTypes")}
                    options={(meta.fuelTypes as string[]) ?? []}
                    value={turboFuelTypes}
                    onChange={setTurboFuelTypes}
                    ui={checkboxUi}
                  />
                </FilterSection>
                <FilterSection title={t("transmissions")}>
                  <CheckboxList
                    label={t("transmissions")}
                    options={(meta.transmissions as string[]) ?? []}
                    value={turboTransmissions}
                    onChange={setTurboTransmissions}
                    ui={checkboxUi}
                  />
                </FilterSection>
                <FilterSection title={t("bodyTypes")}>
                  <CheckboxList
                    label={t("bodyTypes")}
                    options={(meta.bodyTypes as string[]) ?? []}
                    value={turboBodyTypes}
                    onChange={setTurboBodyTypes}
                    ui={checkboxUi}
                  />
                </FilterSection>
                <FilterSection title={t("priceRange")}>
                  <NumberRangeFilter
                    value={turboPriceRange}
                    bounds={turboPriceBounds}
                    onChange={setTurboPriceRange}
                  />
                </FilterSection>
                <FilterSection title={t("yearRange")}>
                  <NumberRangeFilter
                    value={turboYearRange}
                    bounds={turboYearBounds}
                    onChange={setTurboYearRange}
                    formatter={(v) => String(v)}
                  />
                </FilterSection>
                <FilterSection title={t("mileageRange")}>
                  <NumberRangeFilter
                    value={turboMileageRange}
                    bounds={turboMileageBounds}
                    onChange={setTurboMileageRange}
                  />
                </FilterSection>
              </>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 space-y-5 p-6">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-700/50 dark:bg-rose-900/20 dark:text-rose-300">
              {error}
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {project} {t("dashboard")}
              </h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                {t("aggregatedMedian")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label={t("filteredListings")}
              value={kpis.count.toLocaleString("en-US")}
              sub={kpis.latestLabel}
            />
            <KpiCard
              label={medianLabel}
              value={fmtFixed(kpis.medianValue, priceFractionDigits)}
              sub={kpis.latestLabel}
              history={kpis.history}
            />
            <KpiCard
              label={t("latestPeriodChange")}
              value={`${kpis.latestPct > 0 ? "+" : ""}${kpis.latestPct.toFixed(2)}%`}
              sub={kpis.latestLabel}
              accent={
                kpis.latestPct > 0
                  ? "green"
                  : kpis.latestPct < 0
                    ? "red"
                    : "neutral"
              }
              history={kpis.historyPct.map((h) => ({
                label: h.label,
                value: h.value,
              }))}
            />
          </div>

          {insights.length > 0 && (
            <Section title={t("insights")}>
              <InsightReadout insights={insights} />
            </Section>
          )}

          <MarketOverallSummary context={analysisContext} />

          <MarketChat context={analysisContext} disabled={loading || !!error} />

          {trend.length === 0 ? (
            <EmptyState title={t("noDataTitle")} hint={t("noDataHint")} />
          ) : (
            <>
              <Section 
                title={t("priceTrend")}
                extra={
                  canSplitTrend && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={splitTrend}
                        onChange={(e) => setSplitTrend(e.target.checked)}
                        className="accent-blue-500 rounded border-gray-300"
                      />
                      {t("splitBySelection") || "Split lines"}
                    </label>
                  )
                }
              >
                <Chart height={300}>
                  <LineChart
                    data={trend}
                    margin={{ top: 32, right: 32, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke={chartColors.grid}
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateLabel"
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      domain={priceTrendDomain}
                      tickCount={6}
                      tickFormatter={(v: number) =>
                        project === "Markets" ? fmtFixed(v, priceFractionDigits) : fmtNum(v)
                      }
                      width={82}
                    />
                    <Tooltip
                      {...shared}
                      formatter={(v: number | undefined, name: string | undefined) => [
                        fmtFixed(v ?? 0, priceFractionDigits),
                        name === "medianPrice" ? medianLabel : (name ?? ""),
                      ]}
                    />
                    {splitTrend && (
                      <Legend
                        wrapperStyle={{ fontSize: "11px", color: chartColors.tick, paddingTop: "10px" }}
                        iconType="circle"
                      />
                    )}
                    {(!splitTrend || trendGroups.length === 0) && (
                      <Line
                        type="monotone"
                        dataKey="medianPrice"
                        name="medianPrice"
                        stroke="#60a5fa"
                        strokeWidth={2.5}
                        label={(props: ChartLabelProps) => {
                          if (
                            typeof props.x !== "number" ||
                            typeof props.y !== "number" ||
                            typeof props.value !== "number"
                          ) {
                            return null;
                          }
                          const isEven = (props.index ?? 0) % 2 === 0;
                          const offsetY = isEven ? -12 : 18;
                          return (
                            <text
                              x={props.x}
                              y={props.y + offsetY}
                              fill={chartColors.tick}
                              fontSize={9}
                              textAnchor="middle"
                              dominantBaseline={isEven ? "middle" : "middle"}
                            >
                              {project === "Markets"
                                ? fmtFixed(props.value, priceFractionDigits)
                                : fmtNum(props.value)}
                            </text>
                          );
                        }}
                        dot={{ r: 4, fill: "#60a5fa", strokeWidth: 0 }}
                        activeDot={{ r: 6 }}
                      />
                    )}
                    {splitTrend && trendGroups.length > 0 && (
                      <Line
                        type="monotone"
                        dataKey="medianPrice"
                        name={t("aggregatedMedian") || "Median"}
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        label={(props: ChartLabelProps) => {
                          if (
                            typeof props.x !== "number" ||
                            typeof props.y !== "number" ||
                            typeof props.value !== "number"
                          ) {
                            return null;
                          }
                          return (
                            <text
                              x={props.x}
                              y={props.y - 10}
                              fill={chartColors.tick}
                              fontSize={9}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {project === "Markets"
                                ? fmtFixed(props.value, priceFractionDigits)
                                : fmtNum(props.value)}
                            </text>
                          );
                        }}
                        dot={{ r: 3, fill: "#94a3b8", strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                      />
                    )}
                    {splitTrend && trendGroups.map((group, idx) => {
                      const colors = [
                        "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
                        "#10b981", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
                        "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e"
                      ];
                      const color = colors[idx % colors.length];
                      return (
                        <Line
                          key={group}
                          type="monotone"
                          dataKey={group}
                          name={group}
                          stroke={color}
                          strokeWidth={2}
                          label={(props: ChartLabelProps) => {
                            if (
                              typeof props.x !== "number" ||
                              typeof props.y !== "number" ||
                              typeof props.value !== "number"
                            ) {
                              return null;
                            }
                            const offsetY = -10 - (idx % 3) * 9;
                            return (
                              <text
                                x={props.x}
                                y={props.y + offsetY}
                                fill={color}
                                fontSize={9}
                                textAnchor="middle"
                                dominantBaseline="middle"
                              >
                                {project === "Markets"
                                  ? fmtFixed(props.value, priceFractionDigits)
                                  : fmtNum(props.value)}
                              </text>
                            );
                          }}
                          dot={{ r: 3, fill: color, strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                        />
                      );
                    })}
                  </LineChart>
                </Chart>
              </Section>

              <Section title={t("percentChangeTitle")}>
                <Chart height={240}>
                  <LineChart
                    data={trend}
                    margin={{ top: 32, right: 32, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke={chartColors.grid}
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateLabel"
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      domain={percentTrendDomain}
                      tickCount={6}
                      tickFormatter={(v) => `${v.toFixed(1)}%`}
                      width={55}
                    />
                    <ReferenceLine
                      y={0}
                      stroke={chartColors.grid}
                      strokeDasharray="4 4"
                    />
                    <Tooltip
                      {...shared}
                      formatter={(
                        _v: unknown,
                        _n: unknown,
                        entry: { payload?: TrendPoint },
                      ) => [entry?.payload?.pctLabel ?? "", t("change")]}
                    />
                    <Line
                      type="monotone"
                      dataKey="pctChange"
                      stroke="#f97316"
                      strokeWidth={2.5}
                      label={(
                        props: ChartLabelProps,
                      ) => {
                        if (
                          typeof props.x !== "number" ||
                          typeof props.y !== "number" ||
                          typeof props.value !== "number"
                        ) {
                          return null;
                        }
                        const isEven = (props.index ?? 0) % 2 === 0;
                        const offsetY = isEven ? -12 : 16;
                        return (
                          <text
                            x={props.x}
                            y={props.y + offsetY}
                            fill={chartColors.tick}
                            fontSize={9}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {fmtSignedPercent(props.value)}
                          </text>
                        );
                      }}
                      dot={(p: TrendDotProps) => (
                        <circle
                          key={`dot-${p.cx}`}
                          cx={p.cx}
                          cy={p.cy}
                          r={4}
                          fill={
                            (p.payload?.pctChange ?? 0) < 0
                              ? "#f43f5e"
                              : "#34d399"
                          }
                          stroke="none"
                        />
                      )}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </Chart>
              </Section>

              <Section
                title={t("listingsTrend")}
                extra={
                  canSplitTrend && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={splitTrend}
                        onChange={(e) => setSplitTrend(e.target.checked)}
                        className="accent-blue-500 rounded border-gray-300"
                      />
                      {t("splitBySelection") || "Split lines"}
                    </label>
                  )
                }
              >
                <Chart height={280}>
                  <LineChart
                    data={listingCountTrend}
                    margin={{ top: 32, right: 24, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke={chartColors.grid}
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateLabel"
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      domain={listingCountDomain}
                      tickCount={6}
                      tickFormatter={(v: number) => fmtNum(v)}
                      width={70}
                    />
                    <Tooltip
                      {...shared}
                      formatter={(v: number | undefined, name: string | undefined) => [
                        (v ?? 0).toLocaleString("en-US"),
                        name === "count" ? t("countLabel") : (name ?? ""),
                      ]}
                    />
                    {splitTrend && (
                      <Legend
                        wrapperStyle={{ fontSize: "11px", color: chartColors.tick, paddingTop: "10px" }}
                        iconType="circle"
                      />
                    )}
                    {(!splitTrend || trendGroups.length === 0) && (
                      <Line
                        type="monotone"
                        dataKey="count"
                        name="count"
                        stroke="#22c55e"
                        strokeWidth={2.5}
                        label={(props: ChartLabelProps) => {
                          if (
                            typeof props.x !== "number" ||
                            typeof props.y !== "number" ||
                            typeof props.value !== "number"
                          ) {
                            return null;
                          }
                          const isEven = (props.index ?? 0) % 2 === 0;
                          const offsetY = isEven ? -12 : 16;
                          return (
                            <text
                              x={props.x}
                              y={props.y + offsetY}
                              fill={chartColors.tick}
                              fontSize={9}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {fmtNum(props.value)}
                            </text>
                          );
                        }}
                        dot={{ r: 4, fill: "#22c55e", strokeWidth: 0 }}
                        activeDot={{ r: 6 }}
                      />
                    )}
                    {splitTrend && trendGroups.length > 0 && (
                      <Line
                        type="monotone"
                        dataKey="count"
                        name={t("aggregatedCount") || "Total Count"}
                        stroke="#94a3b8"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        label={(props: ChartLabelProps) => {
                          if (
                            typeof props.x !== "number" ||
                            typeof props.y !== "number" ||
                            typeof props.value !== "number"
                          ) {
                            return null;
                          }
                          return (
                            <text
                              x={props.x}
                              y={props.y - 10}
                              fill={chartColors.tick}
                              fontSize={9}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              {fmtNum(props.value)}
                            </text>
                          );
                        }}
                        dot={{ r: 3, fill: "#94a3b8", strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                      />
                    )}
                    {splitTrend && trendGroups.map((group, idx) => {
                      const colors = [
                        "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
                        "#10b981", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
                        "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e"
                      ];
                      const color = colors[idx % colors.length];
                      return (
                        <Line
                          key={group}
                          type="monotone"
                          dataKey={group}
                          name={group}
                          stroke={color}
                          strokeWidth={2}
                          label={(props: ChartLabelProps) => {
                            if (
                              typeof props.x !== "number" ||
                              typeof props.y !== "number" ||
                              typeof props.value !== "number"
                            ) {
                              return null;
                            }
                            const offsetY = -10 - (idx % 3) * 9;
                            return (
                              <text
                                x={props.x}
                                y={props.y + offsetY}
                                fill={color}
                                fontSize={9}
                                textAnchor="middle"
                                dominantBaseline="middle"
                              >
                                {fmtNum(props.value)}
                              </text>
                            );
                          }}
                          dot={{ r: 3, fill: color, strokeWidth: 0 }}
                          activeDot={{ r: 4 }}
                        />
                      );
                    })}
                  </LineChart>
                </Chart>
              </Section>

              <Section title={t("listingCountChangeTitle") || "Listing Count Change"}>
                <Chart height={240}>
                  <LineChart
                    data={listingCountTrend}
                    margin={{ top: 32, right: 32, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      stroke={chartColors.grid}
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="dateLabel"
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke={chartColors.axis}
                      tick={{ fill: chartColors.tick, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      domain={listingCountPctChangeDomain}
                      tickCount={6}
                      tickFormatter={(v) => `${v.toFixed(1)}%`}
                      width={55}
                    />
                    <ReferenceLine
                      y={0}
                      stroke={chartColors.grid}
                      strokeDasharray="4 4"
                    />
                    <Tooltip
                      {...shared}
                      formatter={(
                        _v: unknown,
                        _n: unknown,
                        entry: { payload?: ListingCountPoint },
                      ) => [entry?.payload?.pctLabel ?? "", t("change")]}
                    />
                    <Line
                      type="monotone"
                      dataKey="pctChange"
                      stroke="#f97316"
                      strokeWidth={2.5}
                      label={(
                        props: ChartLabelProps,
                      ) => {
                        if (
                          typeof props.x !== "number" ||
                          typeof props.y !== "number" ||
                          typeof props.value !== "number"
                        ) {
                          return null;
                        }
                        const isEven = (props.index ?? 0) % 2 === 0;
                        const offsetY = isEven ? -12 : 16;
                        return (
                          <text
                            x={props.x}
                            y={props.y + offsetY}
                            fill={chartColors.tick}
                            fontSize={9}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            {fmtSignedPercent(props.value)}
                          </text>
                        );
                      }}
                      dot={(p: TrendDotProps) => (
                        <circle
                          key={`dot-${p.cx}`}
                          cx={p.cx}
                          cy={p.cy}
                          r={4}
                          fill={
                            (p.payload?.pctChange ?? 0) < 0
                              ? "#f43f5e"
                              : "#34d399"
                          }
                          stroke="none"
                        />
                      )}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </Chart>
              </Section>

              {breakdownData.length > 0 && (
                <Section title={`${t("breakdown")} — ${breakdownDimLabel}`}>
                  {/* Dimension selector */}
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                      {t("groupBy")}:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {(project === "Bina.az"
                        ? (["rooms", "region", "category"] as const).map(
                            (d) => ({
                              id: d,
                              label: t(
                                d === "rooms"
                                  ? "byRooms"
                                  : d === "region"
                                    ? "byRegion"
                                    : "byCategory",
                              ),
                              active: breakdownDimBina === d,
                              set: () => setBreakdownDimBina(d),
                            }),
                          )
                        : project === "Markets"
                          ? (["source", "category", "brand"] as const).map(
                              (d) => ({
                                id: d,
                                label: t(
                                  d === "source"
                                    ? "bySource"
                                    : d === "category"
                                      ? "byCategory"
                                      : "byBrand",
                                ),
                                active: breakdownDimMarkets === d,
                                set: () => setBreakdownDimMarkets(d),
                              }),
                            )
                          : (
                              ["fuelType", "bodyType", "transmission"] as const
                            ).map((d) => ({
                              id: d,
                              label: t(
                                d === "fuelType"
                                  ? "byFuelType"
                                  : d === "bodyType"
                                    ? "byBodyType"
                                    : "byTransmission",
                              ),
                              active: breakdownDimTurbo === d,
                              set: () => setBreakdownDimTurbo(d),
                            }))
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          onClick={opt.set}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                            opt.active
                              ? "bg-blue-500 text-white"
                              : "bg-slate-200 text-zinc-600 hover:bg-slate-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto min-w-48">
                      <PillToggle
                        options={[
                          { label: t("aggregate"), value: "aggregate" },
                          { label: t("monthly"), value: "monthly" },
                        ]}
                        value={breakdownMode}
                        onChange={(value) =>
                          setBreakdownMode(value as "aggregate" | "monthly")
                        }
                      />
                    </div>
                  </div>
                  <Chart
                    height={Math.max(
                      200,
                      breakdownData.length * (breakdownMode === "monthly" ? 30 : 38),
                    )}
                  >
                    <BarChart
                      data={breakdownData}
                      layout="vertical"
                      margin={{ top: 4, right: 92, left: 4, bottom: 26 }}
                    >
                      <CartesianGrid
                        stroke={chartColors.grid}
                        strokeDasharray="3 3"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        stroke={chartColors.axis}
                        tick={{ fill: chartColors.tick, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) =>
                          fmtFixed(v, priceFractionDigits)
                        }
                        label={{
                          value: `${medianLabel} / ${t("countLabel")}`,
                          position: "insideBottom",
                          offset: -14,
                          fill: chartColors.tick,
                          fontSize: 10,
                        }}
                      />
                      <YAxis
                        type="category"
                        dataKey="key"
                        width={breakdownMode === "monthly" ? 130 : 90}
                        stroke={chartColors.axis}
                        tick={{ fill: chartColors.tick, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        {...shared}
                        formatter={(v: number | undefined) => [
                          fmtFixed(v ?? 0, priceFractionDigits),
                          medianLabel,
                        ]}
                      />
                      <Bar
                        dataKey="medianPrice"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={28}
                      >
                        <LabelList
                          dataKey="valueLabel"
                          position="right"
                          fill={chartColors.tick}
                          fontSize={10}
                        />
                        {breakdownData.map((_entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={`hsl(${210 + index * 12}, 70%, ${isLight ? 48 : 60}%)`}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </Chart>
                </Section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
