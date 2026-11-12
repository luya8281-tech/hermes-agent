/** Display helpers for the ai-chat styled visual transcript. */

const TOOL_BADGES: Record<string, string> = {
  terminal: "BASH",
  run_bash: "BASH",
  bash: "BASH",
  run_python: "PYTHON",
  browser: "BROWSER",
  browser_navigate: "BROWSER",
  web_search: "SEARCH",
  search: "SEARCH",
  web_extract: "READ",
  fetch: "READ",
  read_file: "READ",
  write_file: "WRITE",
  patch: "EDIT",
  apply_patch: "EDIT",
  search_files: "SEARCH",
  list_directory: "LIST",
  image_generate: "IMAGE",
  vision_analyze: "VISION",
  text_to_speech: "VOICE",
  delegate_task: "AGENT",
  todo: "TASK",
  clarify: "ASK",
};

export function getActionBadge(type?: string, label?: string): string {
  const explicit = (type || "").trim();
  if (explicit && explicit.toUpperCase() !== "TOOL") {
    return explicit.toUpperCase().slice(0, 12);
  }
  const raw = (label || "").trim();
  const lowered = raw.toLowerCase();
  if (TOOL_BADGES[lowered]) return TOOL_BADGES[lowered];
  if (lowered.startsWith("mcp__")) {
    return lowered.split("__").slice(-1)[0].toUpperCase().slice(0, 12);
  }
  return (raw || "TOOL").toUpperCase().slice(0, 12);
}

function oneLine(text: string): string {
  return (text || "")
    .replace(/\s*\n\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function firstToken(text: string): string {
  return (text || "").split(/[|\s]/)[0].trim();
}

export function formatToolSubject(
  toolName: string,
  context?: unknown,
  args?: unknown,
): string {
  const name = (toolName || "").toLowerCase();
  const argRecord =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null;
  const stringArg = (key: string): string => {
    const value = argRecord?.[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const command = stringArg("command");
  if (command) return clip(oneLine(command), 220);

  const path = stringArg("path") || stringArg("file_path") || stringArg("filename");
  if (path) return clip(oneLine(path.split("|")[0]), 180);

  const query =
    stringArg("query") ||
    stringArg("q") ||
    (Array.isArray(argRecord?.queries) ? String((argRecord?.queries as unknown[])[0] ?? "") : "");
  if (query) return clip(oneLine(query.split("|")[0]), 160);

  const url = stringArg("url") || stringArg("target_url");
  if (url) return clip(firstToken(url), 180);

  const hint = typeof context === "string" ? context.trim() : "";
  if (hint) return clip(oneLine(hint), 180);

  if (argRecord) {
    try {
      return clip(oneLine(JSON.stringify(argRecord)), 180);
    } catch {
      return toolName || "tool";
    }
  }
  if (typeof args === "string") return clip(oneLine(args), 180);

  if (name.includes("search")) return "Pencarian";
  return toolName || "tool";
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Tail of a tool log: last few non-empty lines, capped by characters. */
export function tailOutput(text: string, maxLines = 8, maxChars = 900): string {
  if (!text) return "";
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return "";
  const tail = lines.slice(-maxLines).join("\n");
  return tail.length <= maxChars ? tail : tail.slice(-maxChars);
}

export function formatToolOutput(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  if (typeof result !== "object") return String(result);

  const record = result as Record<string, unknown>;
  for (const key of ["output", "content", "text", "stdout"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  if (typeof record.stderr === "string" && record.stderr) return record.stderr as string;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"];

function stripFencedCode(text: string): string {
  return (text || "").replace(/```[\s\S]*?```/g, "");
}

/** Absolute image file paths mentioned outside code blocks, deduped. */
export function extractImagePaths(text: string, limit = 4): string[] {
  const clean = stripFencedCode(text).slice(0, 30000);
  const ext = IMAGE_EXTENSIONS.join("|");
  const re = new RegExp(
    `(?:^|[\\s("'\`<])((?:/[\\w.@%+~=-]+)+\\.(?:${ext}))\\b`,
    "gi",
  );
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null && out.length < limit) {
    const p = m[1];
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Sources already embedded via markdown image syntax, so the auto-detected
 *  row below a message never duplicates an inline markdown image. */
export function extractMarkdownImageSources(text: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) out.push(m[1].trim());
  return out;
}

export interface UserImageAttachment {
  alt: string;
  src: string;
}

/** Split whole-line image references out of a user message: markdown image
 * lines and bare absolute image paths render as photos below the bubble
 * instead of raw text. Anything else stays untouched. */
export function splitUserImages(text: string): {
  text: string;
  images: UserImageAttachment[];
} {
  const lines = (text || "").split("\n");
  const kept: string[] = [];
  const images: UserImageAttachment[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const md = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (md) {
      images.push({ alt: md[1], src: md[2] });
      continue;
    }
    if (
      /^\/(?:[\w.@%+~=-]+\/)*[\w.@%+~=-]+\.(?:png|jpg|jpeg|webp|gif|avif|bmp)$/i.test(
        trimmed,
      )
    ) {
      images.push({ alt: trimmed.split("/").pop() || "Gambar", src: trimmed });
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").replace(/\s+$/, ""), images };
}

export function isToolResultError(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  return Boolean(record.error) || record.success === false || record.ok === false;
}
