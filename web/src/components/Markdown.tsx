import { useMemo, type ReactNode } from "react";

import { ManagedImage } from "./ManagedImage";

/**
 * Lightweight markdown renderer for LLM output.
 * Handles: code blocks, inline code, bold, italic, headers, links, lists, horizontal rules, tables.
 * Leaked ai-chat tool tags (e.g. [KIRIM_FILE: ...]) are stripped outside code blocks.
 * NOT a full CommonMark parser — optimized for typical assistant message patterns.
 *
 * `streaming` renders a blinking caret at the tail of the last block so it
 * appears to hug the final character instead of wrapping onto a new line
 * after a block element (paragraph/list/code/…).
 */
export function Markdown({
  content,
  highlightTerms,
  streaming,
}: {
  content: string;
  highlightTerms?: string[];
  streaming?: boolean;
}) {
  const blocks = useMemo(
    () => parseBlocks(stripToolTagsFromText(content)),
    [content],
  );
  const caret = streaming ? <StreamingCaret /> : null;

  return (
    <div className="text-sm text-foreground leading-relaxed space-y-2">
      {blocks.map((block, i) => (
        <Block
          key={i}
          block={block}
          highlightTerms={highlightTerms}
          caret={caret && i === blocks.length - 1 ? caret : null}
        />
      ))}
      {blocks.length === 0 && caret}
    </div>
  );
}

function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="inline-block w-[0.5em] h-[1em] ml-0.5 align-[-0.15em] bg-foreground/50 animate-pulse"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BlockNode =
  | { type: "code"; lang: string; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: string[] }
  | {
      type: "table";
      header: string[];
      align: ("left" | "center" | "right")[];
      rows: string[][];
    }
  | { type: "paragraph"; content: string };

/* ------------------------------------------------------------------ */
/*  Block parser                                                       */
/* ------------------------------------------------------------------ */

// ai-chat tool tags the model sometimes leaks into prose (e.g. right after
// sending a file). They mean nothing in Hermes: hide them instead of
// showing raw tags in the chat. Closed list on purpose — ordinary bracketed
// prose like [Update] or [1] is left untouched.
const TOOL_TAG_NAMES = [
  "KIRIM_FILE",
  "KIRIM_AUDIO",
  "KIRIM_VIDEO",
  "KIRIM_FOTO",
  "KIRIM_GAMBAR",
  "KIRIM_DOKUMEN",
  "AMBIL_SUBTITEL",
  "AMBIL_HALAMAN",
  "BROWSER",
  "RUN_BASH",
  "RUN_PYTHON",
  "BACA_FILE",
  "EDIT_FILE",
  "BUAT_FILE",
  "HAPUS_FILE",
];
const TOOL_TAG_RE = new RegExp(
  `\\[(?:${TOOL_TAG_NAMES.join("|")})(?::[^\\]\n]*)?\\]`,
  "g",
);

/** Remove leaked tool tags outside fenced code blocks. */
function stripToolTagsFromText(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : line.replace(TOOL_TAG_RE, "");
    })
    .join("\n");
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("|")) return false;
  if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return false;
  return line
    .split("|")
    .some((cell) => /^\s*:?-{2,}:\s*$/.test(cell));
}

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isTableStart(lines: string[], i: number): boolean {
  if (i + 1 >= lines.length) return false;
  if (!lines[i].includes("|")) return false;
  return isTableSeparator(lines[i + 1]);
}

function parseBlocks(text: string): BlockNode[] {
  const lines = text.split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang, content: codeLines.join("\n") });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // GFM table: header row + separator row + body rows
    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i]);
      const separatorCells = splitTableRow(lines[i + 1]);
      const align: ("left" | "center" | "right")[] = separatorCells.map(
        (cell) => {
          const left = cell.startsWith(":");
          const right = cell.endsWith(":");
          if (left && right) return "center";
          if (right) return "right";
          return "left";
        },
      );
      const rows: string[][] = [];
      i += 2;
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        lines[i].includes("|")
      ) {
        const row = splitTableRow(lines[i]);
        while (row.length < header.length) row.push("");
        rows.push(row.slice(0, header.length));
        i++;
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        let item = lines[i].replace(/^[-*+]\s/, "");
        i++;
        // Indented continuation lines belong to this item, not to a new
        // ragged paragraph below the list.
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          /^[ \t]/.test(lines[i]) &&
          !/^[-*+]\s/.test(lines[i].trimStart()) &&
          !/^\d+[.)]\s/.test(lines[i].trimStart()) &&
          !lines[i].trimStart().startsWith("```") &&
          !isTableStart(lines, i)
        ) {
          item += "\n" + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        let item = lines[i].replace(/^\d+[.)]\s/, "");
        i++;
        // Indented continuation lines belong to this item.
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          /^[ \t]/.test(lines[i]) &&
          !/^[-*+]\s/.test(lines[i].trimStart()) &&
          !/^\d+[.)]\s/.test(lines[i].trimStart()) &&
          !lines[i].trimStart().startsWith("```") &&
          !isTableStart(lines, i)
        ) {
          item += "\n" + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,4}\s/) &&
      !lines[i].match(/^[-*+]\s/) &&
      !lines[i].match(/^\d+[.)]\s/) &&
      !lines[i].match(/^[-*_]{3,}\s*$/) &&
      !isTableStart(lines, i)
    ) {
      // Drop leading spaces: the model often indents continuation lines,
      // which pre-wrap would otherwise render as ragged indents.
      paraLines.push(lines[i].trimStart());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", content: paraLines.join("\n") });
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/*  Block renderer                                                     */
/* ------------------------------------------------------------------ */

function Block({
  block,
  highlightTerms,
  caret,
}: {
  block: BlockNode;
  highlightTerms?: string[];
  caret?: ReactNode;
}) {
  switch (block.type) {
    case "code":
      return (
        <pre className="bg-secondary/60 border border-border px-3 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
          <code>
            {block.content}
            {caret}
          </code>
        </pre>
      );

    case "heading": {
      const Tag = `h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4";
      const sizes: Record<string, string> = {
        h1: "text-base font-bold",
        h2: "text-sm font-bold",
        h3: "text-sm font-semibold",
        h4: "text-sm font-medium",
      };
      return (
        <Tag className={sizes[Tag]}>
          <InlineContent text={block.content} highlightTerms={highlightTerms} />
          {caret}
        </Tag>
      );
    }

    case "hr":
      return (
        <>
          <hr className="border-border" />
          {caret}
        </>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      const last = block.items.length - 1;
      return (
        <Tag
          className={`space-y-0.5 ${block.ordered ? "list-decimal" : "list-disc"} pl-5 text-sm`}
        >
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineContent text={item} highlightTerms={highlightTerms} />
              {i === last ? caret : null}
            </li>
          ))}
        </Tag>
      );
    }

    case "table": {
      const align = block.align;
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-sans text-[13px] leading-snug">
            <thead>
              <tr>
                {block.header.map((cell, j) => (
                  <th
                    key={j}
                    style={{ textAlign: align[j] ?? "left" }}
                    className="border-b border-[var(--vc-border)] px-2 py-1.5 font-semibold text-[var(--vc-fg)]"
                  >
                    <InlineContent
                      text={cell}
                      highlightTerms={highlightTerms}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr
                  key={r}
                  className="border-b border-[var(--vc-border)]/50 last:border-b-0"
                >
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      style={{ textAlign: align[j] ?? "left" }}
                      className="px-2 py-1.5 align-top text-[var(--vc-fg)]"
                    >
                      <InlineContent
                        text={cell}
                        highlightTerms={highlightTerms}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {caret}
        </div>
      );
    }

    case "paragraph":
      return (
        <p>
          <InlineContent text={block.content} highlightTerms={highlightTerms} />
          {caret}
        </p>
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Inline parser + renderer                                           */
/* ------------------------------------------------------------------ */

type InlineNode =
  | { type: "text"; content: string }
  | { type: "code"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "link"; text: string; href: string }
  | { type: "image"; alt: string; src: string }
  | { type: "br" };

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  // Pattern priority: image > code > link > bold > italic > bare URL > line break
  const pattern =
    /(!\[([^\]]*)\]\(([^)]+)\))|(`[^`]+`)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\bhttps?:\/\/[^\s<>)\]]+)|(\n)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      // ![alt](src) image — rendered inline, never as raw text
      nodes.push({ type: "image", alt: match[2], src: match[3] });
    } else if (match[4]) {
      // Inline code
      nodes.push({ type: "code", content: match[4].slice(1, -1) });
    } else if (match[5]) {
      // [text](url) link
      nodes.push({ type: "link", text: match[6], href: match[7] });
    } else if (match[8]) {
      // **bold**
      nodes.push({ type: "bold", content: match[9] });
    } else if (match[10]) {
      // *italic*
      nodes.push({ type: "italic", content: match[11] });
    } else if (match[12]) {
      // Bare URL
      nodes.push({ type: "link", text: match[12], href: match[12] });
    } else if (match[13]) {
      // Line break within paragraph
      nodes.push({ type: "br" });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", content: text.slice(lastIndex) });
  }

  return nodes;
}

function InlineContent({
  text,
  highlightTerms,
}: {
  text: string;
  highlightTerms?: string[];
}) {
  const nodes = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "text":
            return (
              <HighlightedText
                key={i}
                text={node.content}
                terms={highlightTerms}
              />
            );
          case "code":
            return (
              <code
                key={i}
                className="bg-secondary/60 px-1.5 py-0.5 text-xs font-mono text-primary/90"
              >
                {node.content}
              </code>
            );
          case "image":
            return (
              <ManagedImage key={i} src={node.src} alt={node.alt} explicit />
            );
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                <HighlightedText text={node.content} terms={highlightTerms} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <HighlightedText text={node.content} terms={highlightTerms} />
              </em>
            );
          case "link": {
            // Security: only render http(s)/mailto links. Other schemes
            // (javascript:, data:, vbscript:) are dropped to plain text so a
            // crafted link in agent/message content can't execute on click.
            const href = node.href.trim();
            if (!/^(https?:|mailto:)/i.test(href)) {
              return (
                <HighlightedText
                  key={i}
                  text={node.text}
                  terms={highlightTerms}
                />
              );
            }
            return (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors"
              >
                {node.text}
              </a>
            );
          }
          case "br":
            return <br key={i} />;
        }
      })}
    </>
  );
}

/** Highlight search terms within a plain text string. */
function HighlightedText({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms || terms.length === 0) return <>{text}</>;

  // Build a regex that matches any of the search terms (case-insensitive)
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-warning/30 text-warning px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
