import { readJsonFile, resolveDataBackend } from "@/lib/data-backend";
import type { ProjectKey } from "@/lib/dashboard-data";

export type SummaryTrendPoint = {
  period: string;
  medianPrice: number;
  count: number;
};

export type SummaryBreakdownPoint = {
  key: string;
  medianPrice: number;
  count: number;
  period?: string;
};

export type DashboardSummary = {
  project: ProjectKey;
  total: number;
  meta: Record<string, unknown>;
  bounds: Record<string, [number, number]>;
  defaultView: {
    count: number;
    trend: SummaryTrendPoint[];
    breakdowns: {
      aggregate: Record<string, SummaryBreakdownPoint[]>;
      monthly: Record<string, SummaryBreakdownPoint[]>;
    };
  };
};

export async function loadDashboardSummary(project: "bina" | "markets" | "turbo") {
  const backend = await resolveDataBackend();
  return readJsonFile<DashboardSummary>(backend, `${project}/summary.json`);
}
