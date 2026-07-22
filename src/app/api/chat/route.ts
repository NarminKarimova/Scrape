import { NextRequest, NextResponse } from "next/server";
import { runChatAnalysisTool } from "@/lib/chat-analysis-tools";
import { marketAiDebugLog } from "@/lib/market-ai-debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
  messages?: ChatMessage[];
  context?: unknown;
};

type GeminiPart =
  | { text: string; thoughtSignature?: string; thought?: boolean }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
      thoughtSignature?: string;
      thought?: boolean;
    }
  | { functionResponse: { name: string; response: unknown } };

type GeminiContent = {
  role: string;
  parts: GeminiPart[];
};

type ToolTrace = {
  name: string;
  args: Record<string, unknown>;
  response: unknown;
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_GENERATE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;
const TOOL_TRACE_PREFIX = "__MARKET_AI_TOOL_TRACE__";
const WEB_TRACE_PREFIX = "__MARKET_AI_WEB_TRACE__";
const ANALYSIS_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "summarize_current_view",
        description:
          "Compute row count, median trend by period, latest period, and previous period for the current dashboard filters.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "summarize_filtered_view",
        description:
          "Compute row count and median trend after applying extra temporary filters. Use this to test a user-mentioned region, category, brand, source, fuel type, body type, room count, period, or price range without changing the UI.",
        parameters: {
          type: "object",
          properties: {
            filters: {
              type: "object",
              description:
                "Filter overrides. Examples: {selectedRegions:['Mərdəkan']}, {categories:['Həyət evi/Bağ evi']}, {brands:['Toyota']}, {periods:['May (H2)','Jun (H1)']}.",
            },
            scope: {
              type: "string",
              enum: ["current", "all", "custom"],
              description:
                "current = apply current UI filters plus overrides. all = ignore UI filters and query all project rows except default operation type. custom = use only provided filters.",
            },
          },
        },
      },
      {
        name: "get_segment_breakdown",
        description:
          "Compute median and count by one segment dimension for current dashboard filters.",
        parameters: {
          type: "object",
          properties: {
            dimension: {
              type: "string",
              description:
                "Segment dimension. Bina: region, category, rooms. Markets: source, category, brand. Turbo: brand, fuelType, bodyType, transmission.",
            },
            limit: {
              type: "number",
              description: "Maximum number of segment rows to return.",
            },
            scope: {
              type: "string",
              enum: ["current", "all", "custom"],
              description: "Whether to use current UI filters, all project data, or only custom filters.",
            },
          },
        },
      },
      {
        name: "compare_periods",
        description:
          "Compare median metric and row count between two periods under current filters. If periods are omitted, compares latest vs previous.",
        parameters: {
          type: "object",
          properties: {
            periodA: { type: "string", description: "Base period." },
            periodB: { type: "string", description: "Comparison period." },
            scope: {
              type: "string",
              enum: ["current", "all", "custom"],
              description: "Whether to use current UI filters, all project data, or only custom filters.",
            },
          },
        },
      },
      {
        name: "find_matching_values",
        description:
          "Search available dimension values in all rows for a user-mentioned text such as a region, category, brand, source, fuel type, body type, or transmission. Use before claiming a value is missing.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Text to search, e.g. Mərdəkan, Toyota, Araz, SUV.",
            },
            limit: {
              type: "number",
              description: "Maximum matches to return.",
            },
            scope: {
              type: "string",
              enum: ["current", "all", "custom"],
              description: "Search current filtered rows or all project rows.",
            },
          },
        },
      },
      {
        name: "compare_segment",
        description:
          "Compare one segment value against the current filtered market and return segment count, median, market median, premium/discount, and segment trend.",
        parameters: {
          type: "object",
          properties: {
            dimension: {
              type: "string",
              description:
                "Dimension name. Bina: region, category, rooms. Markets: source, category, brand. Turbo: brand, fuelType, bodyType, transmission.",
            },
            key: {
              type: "string",
              description: "Exact segment value to compare, e.g. Mərdəkan.",
            },
            scope: {
              type: "string",
              enum: ["current", "all", "custom"],
              description: "Whether to compare inside current filters or all project data.",
            },
          },
        },
      },
      {
        name: "analyze_user_query",
        description:
          "Analyze the user's natural-language question against available market dimensions. Searches mentioned terms and, when possible, compares the best matching segment against the filtered market.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Full user question or phrase to analyze.",
            },
            scope: {
              type: "string",
              enum: ["current", "all", "custom"],
              description: "Use all when user asks about a segment not necessarily selected in UI.",
            },
          },
        },
      },
    ],
  },
];

function badRequest(message: string) {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message): message is ChatMessage => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as Record<string, unknown>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string" &&
        candidate.content.trim().length > 0
      );
    })
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4_000),
    }));
}

function compactContext(context: unknown): string {
  return JSON.stringify(context ?? {}, null, 2).slice(0, 24_000);
}

function debugLog(label: string, data: unknown) {
  marketAiDebugLog("market-chat", label, data);
}

function contextDebugSummary(context: unknown) {
  const c = context as {
    project?: unknown;
    language?: unknown;
    filters?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    breakdown?: Record<string, unknown>;
  };
  return {
    project: c?.project,
    language: c?.language,
    filters: c?.filters,
    metrics: c?.metrics,
    breakdown: c?.breakdown,
  };
}

function extractText(payload: unknown): string {
  const candidates = (payload as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  })?.candidates;
  const text = candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  return text || "";
}

function extractGroundingMetadata(payload: unknown): unknown | null {
  return (
    (payload as { candidates?: { groundingMetadata?: unknown }[] })
      ?.candidates?.[0]?.groundingMetadata ?? null
  );
}

function getModelContent(payload: unknown): GeminiContent | null {
  const content = (payload as { candidates?: { content?: GeminiContent }[] })
    ?.candidates?.[0]?.content;
  return content?.parts?.length ? content : null;
}

function stripApiPrefix(name: string): string {
  return name.includes(":") ? (name.split(":").at(-1) ?? name) : name;
}

function extractFunctionCalls(payload: unknown): { name: string; toolName: string; args: Record<string, unknown> }[] {
  const parts = (payload as {
    candidates?: { content?: { parts?: { functionCall?: { name?: string; args?: Record<string, unknown> } }[] } }[];
  })?.candidates?.[0]?.content?.parts ?? [];

  return parts
    .map((part) => part.functionCall)
    .filter((call): call is { name: string; args: Record<string, unknown> } =>
      typeof call?.name === "string",
    )
    .map((call) => ({ name: call.name, toolName: stripApiPrefix(call.name), args: call.args ?? {} }));
}

function fallbackToolCalls(messages: ChatMessage[]) {
  const lastUserText = messages.at(-1)?.content ?? "";
  return [
    { name: "summarize_current_view", toolName: "summarize_current_view", args: {} },
    { name: "compare_periods", toolName: "compare_periods", args: {} },
    { name: "get_segment_breakdown", toolName: "get_segment_breakdown", args: { limit: 12 } },
    {
      name: "analyze_user_query",
      toolName: "analyze_user_query",
      args: { query: lastUserText, limit: 20, scope: "all" },
    },
  ];
}

function shouldEnableWebSearch(messages: ChatMessage[]): boolean {
  const text = (messages.at(-1)?.content ?? "").toLocaleLowerCase("az-AZ");
  return [
    "web",
    "internet",
    "search",
    "google",
    "xəbər",
    "news",
    "bugün",
    "today",
    "son",
    "latest",
    "current",
    "hazırda",
    "mərkəzi bank",
    "faiz dərəcəsi",
    "macro",
    "makro",
    "əhali",
    "ehali",
    "alıcılıq",
    "aliciliq",
    "inflyasiya",
    "inflation",
    "yaşayış xərci",
  ].some((term) => text.includes(term));
}

async function readGeminiError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return (
      (payload as { error?: { message?: string } })?.error?.message ??
      "Gemini request failed."
    );
  } catch {
    return "Gemini request failed.";
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const messages = sanitizeMessages(body.messages);
  if (messages.length === 0 || messages.at(-1)?.role !== "user") {
    return badRequest("Last chat message must be a user message.");
  }

  const system = [
    "You are a market analysis assistant inside a dashboard.",
    "This bot is used for macroeconomic comparison and population-impact analysis in Azerbaijan.",
    "Focus on how market changes affect households, affordability, purchasing power, living costs, borrowing pressure, and regional inequality.",
    "When relevant, connect real estate, car, and grocery/market price signals to population impact. Do not use external facts unless web search is enabled.",
    "Reply in Azerbaijani by default unless the user asks for another language.",
    "Use only the supplied dashboard context, tool results, and conversation.",
    "You can call tools to compute filtered summaries, segment breakdowns, and period comparisons from dashboard rows.",
    "Do not require the user to change UI filters. For a user-mentioned segment such as Həyət evi, Mərdəkan, Toyota, Araz, SUV, etc., call tools with scope='all' or scope='custom' and filter overrides.",
    "Google Search grounding is available for current external facts, public news, macro context, or definitions. Use it only when the user asks beyond the dashboard data.",
    "When answering dashboard-data questions, prioritize local tool results over web results.",
    "For default summaries, call summarize_current_view. For driver questions, also call get_segment_breakdown or compare_periods.",
    "Explain what changed after filters, selected project, breakdown, and trend settings.",
    "Prioritize concrete numbers, direction, sample size, segment drivers, and caveats.",
    "If context is thin or no rows match, say that directly and suggest the next filter to inspect.",
    "Do not invent rows, external market facts, or forecasts beyond the data.",
  ].join("\n");

  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [
        {
          text: `${system}\n\nCurrent dashboard context:\n${compactContext(body.context)}`,
        },
      ],
    },
    ...messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
  ];

  debugLog("request", {
    messages,
    context: contextDebugSummary(body.context),
    firstContentChars: compactContext(body.context).length,
  });

  try {
    let workingContents = contents;
    const toolTrace: ToolTrace[] = [];
    debugLog("gemini-tool-request", {
      contents: workingContents,
      tools: ANALYSIS_TOOLS,
    });
    const toolDecisionResponse = await fetch(`${GEMINI_GENERATE_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: workingContents,
        tools: ANALYSIS_TOOLS,
        toolConfig: {
          functionCallingConfig: {
            mode: "AUTO",
          },
        },
        generationConfig: {
          temperature: 0.1,
          topP: 0.9,
          maxOutputTokens: 700,
        },
      }),
    });

    if (!toolDecisionResponse.ok) {
      const message = await readGeminiError(toolDecisionResponse);
      return NextResponse.json(
        { error: message },
        { status: toolDecisionResponse.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const toolDecisionPayload = await toolDecisionResponse.json();
    const modelContent = getModelContent(toolDecisionPayload);
    let functionCalls = extractFunctionCalls(toolDecisionPayload).slice(0, 4);
    debugLog("tool-decision", {
      functionCalls,
      modelParts: modelContent?.parts?.map((part) =>
        "functionCall" in part ? { functionCall: part.functionCall } : { text: "text" in part ? part.text.slice(0, 200) : "" },
      ),
    });

    const modelRequestedTools = functionCalls.length > 0 && modelContent;
    if (functionCalls.length === 0) {
      functionCalls = fallbackToolCalls(messages);
      debugLog("tool-fallback", {
        reason: "model returned text without tool calls",
        functionCalls,
      });
    }

    if (functionCalls.length > 0) {
      const toolParts = await Promise.all(
        functionCalls.map(async (call) => {
          const result = await runChatAnalysisTool(call.toolName, call.args, body.context as Record<string, unknown>);
          toolTrace.push({
            name: call.toolName,
            args: call.args,
            response: result,
          });
          debugLog("tool-result", {
            name: call.name,
            localTool: call.toolName,
            args: call.args,
            result,
          });
          return {
            functionResponse: {
              name: call.name,
              response: result,
            },
          };
        }),
      );

      workingContents = [
        ...workingContents,
        ...(modelRequestedTools && modelContent ? [modelContent] : []),
        { role: "user", parts: toolParts },
        {
          role: "user",
          parts: [
            {
              text: "Tool nəticələrinə əsasən istifadəçiyə qısa, konkret yekun cavab yaz. Cavab Azərbaycan dilində olsun, rəqəmləri göstər, uydurma fakt əlavə etmə. Azərbaycanda makroiqtisadi müqayisə və əhaliyə təsir analizi kontekstində yaz: əlçatanlıq, alıcılıq gücü, yaşayış xərci, borclanma təzyiqi və regional fərqləri qeyd et.",
            },
          ],
        },
      ];
    }

    debugLog("gemini-stream-request", { contents: workingContents });
    const enableWebSearch = shouldEnableWebSearch(messages);
    const response = await fetch(`${GEMINI_STREAM_ENDPOINT}?alt=sse&key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: workingContents,
        ...(enableWebSearch ? { tools: [{ googleSearch: {} }] } : {}),
        generationConfig: {
          temperature: 0.25,
          topP: 0.9,
          maxOutputTokens: 900,
        },
      }),
    });

    if (!response.ok) {
      const message = await readGeminiError(response);
      return NextResponse.json(
        { error: message },
        { status: response.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!response.body) {
      return NextResponse.json(
        { error: "Gemini returned an empty stream." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        let streamedChars = 0;
        let fullText = "";
        const groundingMetadata: unknown[] = [];

        controller.enqueue(
          encoder.encode(`${TOOL_TRACE_PREFIX}${JSON.stringify(toolTrace)}\n`),
        );

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() ?? "";

            for (const event of events) {
              const data = event
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("");

              if (!data || data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                const metadata = extractGroundingMetadata(parsed);
                if (metadata) groundingMetadata.push(metadata);
                const text = extractText(parsed);
                if (text) {
                  streamedChars += text.length;
                  fullText += text;
                  controller.enqueue(encoder.encode(text));
                }
              } catch {
                // Ignore malformed partial SSE event frames.
              }
            }
          }

          if (buffer.trim()) {
            const data = buffer
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            if (data && data !== "[DONE]") {
              try {
                const parsed = JSON.parse(data);
                const metadata = extractGroundingMetadata(parsed);
                if (metadata) groundingMetadata.push(metadata);
                const text = extractText(parsed);
                if (text) {
                  streamedChars += text.length;
                  fullText += text;
                  controller.enqueue(encoder.encode(text));
                }
              } catch {
                // Ignore trailing partial event.
              }
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Gemini stream failed.";
          controller.enqueue(encoder.encode(`\n\n[Stream error: ${message}]`));
        } finally {
          if (groundingMetadata.length > 0) {
            const webTrace = {
              name: "google_search",
              args: { mode: "Gemini Google Search grounding" },
              response: groundingMetadata,
            };
            controller.enqueue(
              encoder.encode(`\n${WEB_TRACE_PREFIX}${JSON.stringify([webTrace])}\n`),
            );
          }
          debugLog("stream-complete", { streamedChars, fullText, groundingMetadata });
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini request failed.";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
