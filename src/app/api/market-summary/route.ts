import { NextRequest, NextResponse } from "next/server";
import { runChatAnalysisTool } from "@/lib/chat-analysis-tools";
import { marketAiDebugLog } from "@/lib/market-ai-debug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent`;

function compact(value: unknown, limit = 18_000): string {
  return JSON.stringify(value ?? {}, null, 2).slice(0, limit);
}

function extractText(payload: unknown): string {
  const candidates = (payload as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  })?.candidates;
  return candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
}

function debugLog(label: string, data: unknown) {
  marketAiDebugLog("market-summary", label, data);
}

async function readGeminiError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return (
      (payload as { error?: { message?: string } })?.error?.message ??
      "Gemini summary request failed."
    );
  } catch {
    return "Gemini summary request failed.";
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

  let context: Record<string, unknown>;
  try {
    const body = (await request.json()) as { context?: Record<string, unknown> };
    context = body.context ?? {};
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [summary, breakdown, periodCompare] = await Promise.all([
    runChatAnalysisTool("summarize_current_view", {}, context),
    runChatAnalysisTool("get_segment_breakdown", { limit: 8 }, context),
    runChatAnalysisTool("compare_periods", {}, context),
  ]);

  debugLog("request", {
    context,
    toolResults: { summary, breakdown, periodCompare },
  });

  const legacyPrompt = [
    "Sən Bank of Baku üçün dashboard daxilində bazar xülasəsi yazan analitiksən.",
    "Cavab Azərbaycan dilində olsun.",
    "Markdown istifadə et: 1 qısa giriş cümləsi, sonra 3-5 bullet.",
    "Yalnız verilən dashboard konteksti və tool nəticələrindən istifadə et.",
    "Rəqəmləri konkret göstər, risk/caveat varsa yaz. Heç nə uydurma.",
    "",
    `Dashboard context:\n${compact(context)}`,
    "",
    `Tool results:\n${compact({ summary, breakdown, periodCompare })}`,
  ].join("\n");
  void legacyPrompt;
  const improvedPrompt = [
    "Sən Bank of Baku üçün Azərbaycanda bank seqmentində bazar analizi yazan senior analitiksən.",
    "Cavab Azərbaycan dilində olsun.",
    "Yalnız verilən dashboard konteksti və tool nəticələrindən istifadə et. Xarici bazar faktı və proqnoz uydurma.",
    "Məqsəd: bank qərarları üçün qısa, istifadəyə hazır bazar oxunuşu vermək.",
    "Markdown formatı:",
    "1) Bir cümləlik **Nəticə**.",
    "2) 4 bullet: **Qiymət**, **Həcm**, **Seqment drayveri**, **Bank üçün siqnal**.",
    "3) Son sətir: **Növbəti baxılmalı sual:** konkret bir analitik sual.",
    "Rəqəmləri konkret göstər: median, dəyişmə faizi, say, ən güclü/zəif seqment varsa adı.",
    "Əgər nümunə azdırsa və ya məlumat boşdursa, bunu açıq caveat kimi yaz.",
    "Ton: qısa, qərar yönümlü, dashboard rəhbərliyi üçün uyğun.",
    "",
    `Dashboard context:\n${compact(context)}`,
    "",
    `Tool results:\n${compact({ summary, breakdown, periodCompare })}`,
  ].join("\n");
  void improvedPrompt;
  const macroPrompt = [
    "Sən Azərbaycanda makroiqtisadi müqayisə və əhaliyə təsir analizi yazan senior analitiksən.",
    "Cavab Azərbaycan dilində olsun.",
    "Yalnız verilən dashboard konteksti və tool nəticələrindən istifadə et. Xarici fakt və proqnoz uydurma.",
    "Məqsəd: bazar qiymətlərindəki dəyişmənin əhali üçün nə demək olduğunu izah etmək.",
    "Xüsusilə bax: əlçatanlıq, alıcılıq gücü, yaşayış xərci, borclanma təzyiqi, regional bərabərsizlik, tələbin zəifləməsi/güclənməsi.",
    "Layihə Bina.az, Turbo.az və Markets datalarını makro müqayisə üçün istifadə edir: daşınmaz əmlak, avtomobil və istehlak səbəti siqnallarını əhali təsiri kimi şərh et.",
    "Markdown formatı:",
    "1) Bir cümləlik **Nəticə**.",
    "2) 5 bullet: **Qiymət siqnalı**, **Həcm siqnalı**, **Əhaliyə təsir**, **Makro şərh**, **Risk/caveat**.",
    "3) Son sətir: **Növbəti baxılmalı sual:** konkret analitik sual.",
    "Rəqəmləri göstər: median, dəyişmə faizi, say, əsas seqment.",
    "Ton: qısa, praktik, rəhbərlik üçün qərar yönümlü.",
    "",
    `Dashboard context:\n${compact(context)}`,
    "",
    `Tool results:\n${compact({ summary, breakdown, periodCompare })}`,
  ].join("\n");

  try {
    debugLog("gemini-request", {
      contents: [{ role: "user", parts: [{ text: macroPrompt }] }],
    });
    const response = await fetch(`${GEMINI_STREAM_ENDPOINT}?alt=sse&key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: macroPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 650,
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
        { error: "Gemini returned an empty summary stream." },
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
                const text = extractText(JSON.parse(data));
                if (text) {
                  streamedChars += text.length;
                  fullText += text;
                  controller.enqueue(encoder.encode(text));
                }
              } catch {
                // Ignore malformed partial event.
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
                const text = extractText(JSON.parse(data));
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
        } finally {
          debugLog("stream-complete", { streamedChars, fullText });
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
    const message = error instanceof Error ? error.message : "Gemini summary request failed.";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
