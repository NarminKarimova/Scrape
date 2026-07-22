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
    <section className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {isAz ? "Gemini bazar xülasəsi" : "Gemini market summary"}
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">
            {isAz
              ? "Filtrləri seç, sonra Gemini ilə xülasəni yenilə"
              : "Set filters, then regenerate the Gemini summary"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isStale && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {isAz ? "Filtrlər dəyişib" : "Filters changed"}
            </span>
          )}
          <button
            onClick={() => void generateSummary()}
            disabled={loading}
            className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
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

