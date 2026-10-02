"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownText } from "@/components/markdown-text";

export type ChatProjectKey = "Bina.az" | "Markets" | "Birmarket" | "Turbo.az";
export type ChatLang = "en" | "az";

export type ChatTrendPoint = {
  period: string;
  dateLabel: string;
  medianPrice: number;
  pctChange: number;
  pctLabel: string;
};

export type ChatListingCountPoint = {
  period: string;
  dateLabel: string;
  count: number;
  pctChange: number;
  pctLabel: string;
} & Record<string, string | number>;

export type ChatBreakdownPoint = {
  key: string;
  medianPrice: number;
  count: number;
  valueLabel: string;
  period?: string;
  dateLabel?: string;
};

export type AnalysisContext = {
  project: ChatProjectKey;
  language: ChatLang;
  filters: Record<string, unknown>;
  metrics: Record<string, unknown>;
  trends: {
    price: ChatTrendPoint[];
    listings: ChatListingCountPoint[];
  };
  breakdown: {
    dimension: string;
    mode: "aggregate" | "monthly";
    points: ChatBreakdownPoint[];
  };
  insights: string[];
};

type ToolTrace = {
  name: string;
  args: Record<string, unknown>;
  response: unknown;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolTrace[];
  createdAt: number;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

const LEGACY_HISTORY_KEY = "bank-of-baku-market-chat-history-v2";
const SESSIONS_KEY_PREFIX = "bank-of-baku-market-chat-sessions-v1";
const ACTIVE_SESSION_KEY_PREFIX = "bank-of-baku-market-chat-active-session-v1";
const TOOL_TRACE_PREFIX = "__MARKET_AI_TOOL_TRACE__";
const WEB_TRACE_PREFIX = "__MARKET_AI_WEB_TRACE__";

const TEXT = {
  en: {
    title: "Macro market analyst",
    extra: "Macroeconomic comparison and population-impact analysis",
    context: "Current context",
    rows: "rows",
    noPeriod: "No period",
    placeholder:
      "Ask about regions, prices, macro comparison, affordability, population impact, or web search...",
    analyzing: "Analyzing current view...",
    buttonIdle: "Send",
    buttonBusy: "Analyzing...",
    noAnswer: "No answer returned.",
    streamError: "Chat stream did not open",
    requestError: "Chat request failed",
    emptyTitle: "Ask Gemini about this market view",
    emptyHint:
      "History is saved in this browser. Use tools panel to inspect data calls and web grounding.",
    toolsTitle: "Tools",
    toolArgs: "Arguments",
    toolResponse: "Response",
    clear: "Clear",
    newChat: "New chat",
    chats: "Chats",
    untitled: "New chat",
    fullscreen: "Full screen",
    exitFullscreen: "Exit full screen",
    edit: "Edit",
    resend: "Resend",
    cancel: "Cancel",
    saveResend: "Save & resend",
    history: "History saved",
  },
  az: {
    title: "Makro bazar analitiki",
    extra: "Azərbaycan bank seqmenti üçün bazar analizi",
    context: "Cari kontekst",
    rows: "sətir",
    noPeriod: "Dövr yoxdur",
    placeholder:
      "Region, qiymət təzyiqi, son dəyişiklik, bank siqnalı və ya web search haqqında soruş...",
    analyzing: "Cari görünüş analiz olunur...",
    buttonIdle: "Göndər",
    buttonBusy: "Analiz olunur...",
    noAnswer: "Cavab qayıtmadı.",
    streamError: "Chat axını açılmadı",
    requestError: "Chat sorğusu uğursuz oldu",
    emptyTitle: "Gemini-yə cari bazar görünüşü haqqında sual ver",
    emptyHint:
      "Tarixçə bu brauzerdə saxlanır. Data tool-ları və web grounding üçün alətlər panelini aç.",
    toolsTitle: "Alətlər",
    toolArgs: "Arqumentlər",
    toolResponse: "Cavab",
    clear: "Təmizlə",
    newChat: "Yeni chat",
    chats: "Chatlar",
    untitled: "Yeni chat",
    fullscreen: "Tam ekran",
    exitFullscreen: "Çıx",
    edit: "Düzəlt",
    resend: "Yenidən göndər",
    cancel: "Ləğv et",
    saveResend: "Yadda saxla və göndər",
    history: "Tarixçə saxlanır",
  },
};

function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function serializeMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function sessionTitle(messages: ChatMessage[], fallback: string): string {
  return (
    messages.find((message) => message.role === "user")?.content.slice(0, 48) ||
    fallback
  );
}

function createSession(title: string, messages: ChatMessage[] = []): ChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: title || "New chat",
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

function projectStorageSuffix(project: ChatProjectKey): string {
  return project.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function sessionsKey(project: ChatProjectKey): string {
  return `${SESSIONS_KEY_PREFIX}:${projectStorageSuffix(project)}`;
}

function activeSessionKey(project: ChatProjectKey): string {
  return `${ACTIVE_SESSION_KEY_PREFIX}:${projectStorageSuffix(project)}`;
}

function safeLoadSessions(
  fallbackTitle: string,
  project: ChatProjectKey,
): {
  sessions: ChatSession[];
  activeId: string;
} {
  if (typeof window === "undefined") {
    const session = createSession(fallbackTitle);
    return { sessions: [session], activeId: session.id };
  }
  try {
    const raw = window.localStorage.getItem(sessionsKey(project));
    const activeId = window.localStorage.getItem(activeSessionKey(project));
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      const sessions = Array.isArray(parsed)
        ? parsed.filter((session) => session && typeof session.id === "string")
        : [];
      if (sessions.length > 0) {
        return {
          sessions,
          activeId:
            activeId && sessions.some((session) => session.id === activeId)
              ? activeId
              : sessions[0].id,
        };
      }
    }

    const legacyRaw =
      project === "Bina.az" ? window.localStorage.getItem(LEGACY_HISTORY_KEY) : null;
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as ChatMessage[];
      const messages = Array.isArray(legacy)
        ? legacy.filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string",
          )
        : [];
      if (messages.length > 0) {
        const session = createSession(sessionTitle(messages, fallbackTitle), messages);
        return { sessions: [session], activeId: session.id };
      }
    }
  } catch {
    // Fall through to empty session.
  }

  const session = createSession(fallbackTitle);
  return { sessions: [session], activeId: session.id };
}

function ToolTracePanel({
  traces,
  text,
}: {
  traces: ToolTrace[];
  text: typeof TEXT.en;
}) {
  if (traces.length === 0) return null;

  return (
    <details className="mb-2 rounded-xl border border-slate-200 bg-white/70 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-950/60">
      <summary className="cursor-pointer select-none font-semibold text-zinc-600 dark:text-zinc-300">
        {text.toolsTitle} ({traces.length})
      </summary>
      <div className="mt-2 space-y-2">
        {traces.map((trace, index) => (
          <div
            key={`${trace.name}-${index}`}
            className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="font-semibold text-blue-600 dark:text-blue-300">
              {trace.name}
            </div>
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <div>
                <div className="mb-1 font-semibold text-zinc-500">
                  {text.toolArgs}
                </div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                  {JSON.stringify(trace.args, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1 font-semibold text-zinc-500">
                  {text.toolResponse}
                </div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                  {JSON.stringify(trace.response, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

export function MarketChat({
  context,
  disabled,
  workspace = false,
}: {
  context: AnalysisContext;
  disabled: boolean;
  workspace?: boolean;
}) {
  const baseText = TEXT[context.language] ?? TEXT.az;
  const text =
    context.language === "az"
      ? {
          ...baseText,
          title: "Makro bazar analitiki",
          extra: "Makroiqtisadi müqayisə və əhaliyə təsir analizi",
          placeholder:
            "Region, qiymət təzyiqi, makro müqayisə, əlçatanlıq, əhaliyə təsir və ya web search haqqında soruş...",
          emptyHint:
            "Azərbaycanda makroiqtisadi müqayisə, bazar təzyiqi, əlçatanlıq və əhaliyə təsir analizi üçün istifadə olunur.",
        }
      : {
          ...baseText,
          title: "Macro market analyst",
          extra: "Macroeconomic comparison and population-impact analysis",
          placeholder:
            "Ask about regions, prices, macro comparison, affordability, population impact, or web search...",
          emptyHint:
            "Used for macroeconomic comparison, market pressure, affordability, and population-impact analysis in Azerbaijan.",
        };
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = safeLoadSessions(text.untitled, context.project);
    setSessions(loaded.sessions);
    setActiveSessionId(loaded.activeId);
    setMessages(
      loaded.sessions.find((session) => session.id === loaded.activeId)?.messages ??
        [],
    );
  }, [text.untitled, context.project]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeSessionId) return;
    setSessions((current) => {
      const now = Date.now();
      const next = current
        .map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                messages: messages.slice(-50),
                title: sessionTitle(messages, text.untitled),
                updatedAt: now,
              }
            : session,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
      window.localStorage.setItem(sessionsKey(context.project), JSON.stringify(next));
      window.localStorage.setItem(activeSessionKey(context.project), activeSessionId);
      return next;
    });
  }, [messages, activeSessionId, text.untitled, context.project]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending, fullscreen]);

  const editMessage = (message: ChatMessage) => {
    setInput(message.content);
    setEditingId(message.id);
  };

  const clearChat = () => {
    setMessages([]);
    setInput("");
    setEditingId(null);
    setError(null);
  };

  const startNewChat = () => {
    const session = createSession(text.untitled);
    setSessions((current) => [session, ...current].slice(0, 20));
    setActiveSessionId(session.id);
    setMessages([]);
    setInput("");
    setEditingId(null);
    setError(null);
  };

  const switchSession = (session: ChatSession) => {
    if (sending) return;
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setInput("");
    setEditingId(null);
    setError(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(activeSessionKey(context.project), session.id);
    }
  };

  const runConversation = async (nextMessages: ChatMessage[]) => {
    setMessages(nextMessages);
    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: serializeMessages(nextMessages),
          context,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || text.requestError);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error(text.streamError);

      const decoder = new TextDecoder();
      const assistant: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };
      setMessages((current) => [...current, assistant]);

      let reply = "";
      let pending = "";
      let readingMetadata = true;

      const updateAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistant.id ? { ...message, ...patch } : message,
          ),
        );
      };

      const appendToolTrace = (traces: ToolTrace[]) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistant.id
              ? {
                  ...message,
                  toolCalls: [...(message.toolCalls ?? []), ...traces],
                }
              : message,
          ),
        );
      };

      const parseTraceLine = (line: string) => {
        if (line.startsWith(TOOL_TRACE_PREFIX)) {
          appendToolTrace(JSON.parse(line.slice(TOOL_TRACE_PREFIX.length)) as ToolTrace[]);
          return true;
        }
        if (line.startsWith(WEB_TRACE_PREFIX)) {
          appendToolTrace(JSON.parse(line.slice(WEB_TRACE_PREFIX.length)) as ToolTrace[]);
          return true;
        }
        return false;
      };

      const consumeText = (chunk: string) => {
        pending += chunk;

        while (readingMetadata && pending.includes("\n")) {
          const newlineIndex = pending.indexOf("\n");
          const line = pending.slice(0, newlineIndex);
          pending = pending.slice(newlineIndex + 1);
          try {
            if (parseTraceLine(line)) {
              readingMetadata = false;
              continue;
            }
          } catch {
            readingMetadata = false;
            continue;
          }
          readingMetadata = false;
          reply += `${line}\n`;
          updateAssistant({ content: reply });
        }

        if (!readingMetadata && pending) {
          const webIndex = pending.indexOf(`\n${WEB_TRACE_PREFIX}`);
          if (webIndex >= 0) {
            const beforeTrace = pending.slice(0, webIndex);
            reply += beforeTrace;
            const traceStart = webIndex + 1;
            const traceEnd = pending.indexOf("\n", traceStart);
            if (traceEnd === -1) {
              pending = pending.slice(traceStart);
              updateAssistant({ content: reply });
              return;
            }
            const line = pending.slice(traceStart, traceEnd);
            pending = pending.slice(traceEnd + 1);
            try {
              parseTraceLine(line);
            } catch {
              // Ignore malformed trace.
            }
            updateAssistant({ content: reply });
            if (pending) consumeText("");
            return;
          }

          reply += pending;
          pending = "";
          updateAssistant({ content: reply });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeText(decoder.decode(value, { stream: true }));
      }

      consumeText(decoder.decode());
      if (pending) reply += pending;
      updateAssistant({ content: reply.trim() || text.noAnswer });
    } catch (err) {
      setError(err instanceof Error ? err.message : text.requestError);
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    const prompt = input.trim();
    if (!prompt || sending || disabled) return;

    let nextMessages: ChatMessage[];
    if (editingId) {
      const editIndex = messages.findIndex((message) => message.id === editingId);
      if (editIndex < 0) return;
      nextMessages = [
        ...messages.slice(0, editIndex),
        {
          ...messages[editIndex],
          content: prompt,
          createdAt: Date.now(),
        },
      ];
    } else {
      nextMessages = [
        ...messages,
        { id: newId(), role: "user", content: prompt, createdAt: Date.now() },
      ];
    }

    setInput("");
    setEditingId(null);
    await runConversation(nextMessages);
  };

  const resendFrom = async (message: ChatMessage) => {
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < 0 || message.role !== "user" || sending || disabled) return;
    await runConversation(messages.slice(0, index + 1));
  };

  const activeShell = fullscreen
    ? "fixed inset-3 z-50 flex flex-col rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-[#0b101a]"
    : workspace
      ? "bg-transparent"
      : "rounded-[1.4rem] border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_18px_45px_rgba(15,23,42,0.035)] sm:p-6 dark:border-slate-800 dark:bg-[#111827] dark:shadow-none";

  const messageAreaHeight = fullscreen
    ? "min-h-0 flex-1"
    : "min-h-96 max-h-[34rem]";

  return (
    <section className={activeShell}>
      <div className={`mb-5 flex flex-wrap items-start gap-4 ${workspace ? "justify-end" : "justify-between"}`}>
        {!workspace && (
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-xs font-semibold text-white dark:bg-white dark:text-slate-950">
            AI
          </div>
          <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-white">
            {text.title}
          </h2>
          <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            {text.extra} <span className="text-slate-300 dark:text-slate-600">·</span> {text.history}
          </p>
          </div>
        </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={startNewChat}
            disabled={sending}
            className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {text.newChat}
          </button>
          <button
            onClick={() => setFullscreen((value) => !value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300"
          >
            {fullscreen ? text.exitFullscreen : text.fullscreen}
          </button>
          <button
            onClick={clearChat}
            disabled={sending || messages.length === 0}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
          >
            {text.clear}
          </button>
          <div className="rounded-xl bg-emerald-50 px-2.5 py-2 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            AI online
          </div>
        </div>
      </div>

      <div className={`grid gap-4 ${fullscreen ? "min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_320px]" : "xl:grid-cols-[minmax(0,1fr)_280px]"}`}>
        <div className={`flex ${messageAreaHeight} flex-col rounded-2xl border border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/50`}>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex h-full min-h-60 items-center justify-center">
                <div className="max-w-md text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                    AI
                  </div>
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {text.emptyTitle}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    {text.emptyHint}
                  </p>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`group rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto max-w-[85%] bg-indigo-600 text-white shadow-sm"
                    : "mr-auto max-w-[92%] border border-slate-200 bg-white text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                }`}
              >
                {message.role === "assistant" ? (
                  <>
                    <ToolTracePanel traces={message.toolCalls ?? []} text={text} />
                    <MarkdownText text={message.content} />
                  </>
                ) : (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )}
                {message.role === "user" && (
                  <div className="mt-2 flex gap-2 opacity-80">
                    <button
                      onClick={() => editMessage(message)}
                      disabled={sending}
                      className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/25 disabled:opacity-40"
                    >
                      {text.edit}
                    </button>
                    <button
                      onClick={() => void resendFrom(message)}
                      disabled={sending}
                      className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/25 disabled:opacity-40"
                    >
                      {text.resend}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="mr-auto rounded-2xl bg-slate-100 px-3.5 py-2.5 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                {text.analyzing}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold text-zinc-700 dark:text-zinc-200">
                {text.chats}
              </div>
              <span className="text-[11px] text-zinc-400">
                {sessions.length}
              </span>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => switchSession(session)}
                  disabled={sending}
                  className={`w-full rounded-xl px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    session.id === activeSessionId
                      ? "bg-blue-600 text-white"
                      : "bg-white text-zinc-600 hover:bg-slate-100 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                  title={session.title}
                >
                  <div className="truncate text-xs font-semibold">
                    {session.title || text.untitled}
                  </div>
                  <div className={`mt-0.5 text-[10px] ${
                    session.id === activeSessionId ? "text-blue-100" : "text-zinc-400"
                  }`}>
                    {new Date(session.updatedAt).toLocaleString("az-AZ", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
            <div className="font-semibold text-zinc-700 dark:text-zinc-200">
              {text.context}
            </div>
            <div className="mt-2 space-y-1">
              <p>{context.project}</p>
              <p>
                {Number(context.metrics.filteredRows ?? 0).toLocaleString("en-US")}{" "}
                {text.rows}
              </p>
              <p>{String(context.metrics.latestPeriod ?? text.noPeriod)}</p>
              <p>
                {context.breakdown.dimension}, {context.breakdown.mode}
              </p>
            </div>
          </div>

          {editingId && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {context.language === "az"
                ? "Mesaj düzəldilir. Göndəriləndə sonrakı cavablar yenidən qurulacaq."
                : "Editing message. Sending rebuilds the conversation after it."}
            </div>
          )}

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={text.placeholder}
            className={`${fullscreen ? "h-48" : "h-32"} w-full resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-zinc-700 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:focus:border-blue-500`}
          />
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={() => void sendMessage()}
              disabled={disabled || sending || input.trim().length === 0}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending
                ? text.buttonBusy
                : editingId
                  ? text.saveResend
                  : text.buttonIdle}
            </button>
            {editingId && (
              <button
                onClick={() => {
                  setEditingId(null);
                  setInput("");
                }}
                disabled={sending}
                className="rounded-2xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-zinc-600 hover:border-slate-400 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
              >
                {text.cancel}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
