"use client";

import { useMemo, useRef, useState } from "react";
import { MarkdownText } from "@/components/markdown-text";
import type { AnalysisContext } from "@/components/market-chat";

function contextKey(context: AnalysisContext): string {
  return JSON.stringify({
    project: context.project,
    language: context.language,
    filters: context.filters,
    metrics: context.metrics,
    breakdown: context.breakdown.dimension,
    breakdownMode: context.breakdown.mode,
  });
}

export function MarketOverallSummary({ context }: { context: AnalysisContext }) {
  const isAz = context.language === "az";
  const key = useMemo(() => contextKey(context), [context]);
  const [summary, setSummary] = useState("");
  const [summaryKey, setSummaryKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isStale = Boolean(summary && summaryKey !== key);

  const generateSummary = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setSummary("");

    try {
      const response = await fetch("/api/market-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Summary request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Summary stream did not open");

      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setSummary(text);
      }
      text += decoder.decode();
      setSummary(text.trim());
      setSummaryKey(key);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Summary request failed");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  return (
    <section className="flex h-full flex-col rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_18px_45px_rgba(15,23,42,0.035)] sm:p-6 dark:border-slate-800 dark:bg-[#111827] dark:shadow-none">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_8px_20px_rgba(99,102,241,0.22)]">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" strokeLinecap="round" />
              <circle cx="12" cy="12" r="3.5" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-white">
              {isAz ? "AI bazar xülasəsi" : "AI market summary"}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            {isAz
              ? "Cari filtrlərdən qısa, qərar-yönümlü xülasə hazırla"
              : "Turn current filters into a concise, decision-ready summary"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isStale && (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {isAz ? "Filtrlər dəyişib" : "Filters changed"}
            </span>
          )}
          <button
            onClick={() => void generateSummary()}
            disabled={loading}
            className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? isAz
                ? "Yazılır..."
                : "Writing..."
              : summary
                ? isAz
                  ? "Yenidən yarat"
                  : "Regenerate"
                : isAz
                  ? "Xülasə yarat"
                  : "Generate summary"}
          </button>
        </div>
      </div>

      <div className="flex-1 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
        {error ? (
          <p className="text-rose-500">{error}</p>
        ) : summary ? (
          <MarkdownText text={summary} />
        ) : (
          <p className="text-zinc-500">
            {isAz
              ? "Gemini xülasəsi hələ yaradılmayıb. Cari filtrlər üzrə nəticə almaq üçün düyməyə kliklə."
              : "Gemini summary has not been generated yet. Click the button to summarize current filters."}
          </p>
        )}
      </div>
    </section>
  );
}

