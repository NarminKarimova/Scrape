"use client";

import type { ReactNode } from "react";

type Segment =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string };

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**")) {
      segments.push({ type: "strong", value: token.slice(2, -2) });
    } else {
      segments.push({ type: "em", value: token.slice(1, -1) });
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) => {
        if (segment.type === "strong") {
          return (
            <strong key={index} className="font-semibold text-zinc-900 dark:text-zinc-50">
              {segment.value}
            </strong>
          );
        }
        if (segment.type === "em") {
          return (
            <em key={index} className="italic">
              {segment.value}
            </em>
          );
        }
        return <span key={index}>{segment.value}</span>;
      })}
    </>
  );
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])\s+\*\s+/g, "$1\n* ")
    .replace(/([^\n])\s+-\s+/g, "$1\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isListLine(line: string): boolean {
  return /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
}

function stripListMarker(line: string): string {
  return line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
}

export function MarkdownText({ text }: { text: string }) {
  const normalized = normalizeMarkdown(text);
  if (!normalized) return null;

  const lines = normalized.split("\n");
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const value = paragraph.join(" ").trim();
    paragraph = [];
    if (!value) return;
    nodes.push(
      <p key={`p-${nodes.length}`} className="leading-7">
        <InlineMarkdown text={value} />
      </p>,
    );
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="list-disc space-y-1.5 pl-5 leading-7">
        {items.map((item, index) => (
          <li key={index} className="pl-1">
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>,
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      flushParagraph();
      flushList();
      nodes.push(
        <h3 key={`h-${nodes.length}`} className="pt-1 text-sm font-semibold leading-6 text-zinc-900 dark:text-zinc-50">
          <InlineMarkdown text={line.replace(/^#{1,3}\s+/, "")} />
        </h3>,
      );
      continue;
    }

    if (isListLine(line)) {
      flushParagraph();
      listItems.push(stripListMarker(line));
      continue;
    }

    if (listItems.length > 0) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${line}`;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return <div className="space-y-3">{nodes}</div>;
}
