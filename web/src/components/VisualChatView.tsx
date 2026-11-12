import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Cpu,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Wrench,
  Globe,
  FolderSearch,
  ShieldCheck,
  Paperclip,
  X,
  PanelRight,
  FileText,
} from "lucide-react";

import { api } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { normalizeSessionTitle } from "@/lib/chat-title";
import {
  ATTACH_ACCEPT,
  extractImagePaths,
  extractMarkdownImageSources,
  fileExtension,
  formatDuration,
  formatToolOutput,
  formatToolSubject,
  isDocFileName,
  isImageFileName,
  isToolResultError,
  splitUserAttachments,
} from "@/lib/chat-display";
import { uploadChatImage } from "@/lib/chatImagePaste";
import { uploadChatFile } from "@/lib/chatFileUpload";
import { ChatOperationSummary } from "./ChatOperationSummary";
import { ChatThinkingCard } from "./ChatThinkingCard";
import {
  LiveActionCard,
  VeeSpinner,
  settleActions,
  type ActionInfo,
} from "./LiveActionCard";
import { ManagedImage } from "./ManagedImage";
import { Markdown } from "./Markdown";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  actions?: ActionInfo[];
  isStreaming?: boolean;
  startedAt?: number;
  latencyMs?: number;
  error?: string;
}

export interface VisualChatViewProps {
  channel?: string;
  scopedProfile?: string;
  resumeSessionId?: string | null;
  onSessionChange?: (sessionId: string) => void;
  onNewChat?: () => void;
  onSwitchToTerminal?: () => void;
  onOpenModelTools?: () => void;
}

interface HistoryRow {
  role?: string;
  text?: string;
  content?: string | null;
  name?: string;
  context?: string;
  args?: unknown;
  tool_call_id?: string;
  reasoning?: string;
  reasoning_content?: string;
}

interface RpcEventPayload {
  type?: string;
  session_id?: string;
  payload?: {
    text?: string;
    tool_id?: string;
    name?: string;
    context?: string;
    args?: unknown;
    duration_s?: number;
    result?: unknown;
    error?: string;
    status?: string;
    model?: string;
    title?: string;
    stored_session_id?: string;
    message?: string;
  };
}

interface RpcFrame {
  id?: string;
  method?: string;
  result?: {
    session_id?: string;
    stored_session_id?: string;
    messages?: HistoryRow[];
    message_count?: number;
    running?: boolean;
    info?: { model?: string; title?: string; stored_session_id?: string };
  };
  error?: { message?: string; code?: number };
  params?: RpcEventPayload;
}

function projectHistory(rows: HistoryRow[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;
  let seq = 0;

  const ensureAssistant = (): ChatMessage => {
    if (!assistant) {
      assistant = {
        id: `hist_a_${seq++}`,
        role: "assistant",
        content: "",
        actions: [],
        isStreaming: false,
      };
      messages.push(assistant);
    }
    return assistant;
  };

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    if (row.role === "user") {
      const text = row.text ?? row.content ?? "";
      if (!text) continue;
      assistant = null;
      messages.push({
        id: `hist_u_${seq++}`,
        role: "user",
        content: text,
      });
      continue;
    }

    if (row.role === "assistant") {
      const text = row.text ?? row.content ?? "";
      const reasoning =
        typeof row.reasoning === "string"
          ? row.reasoning
          : typeof row.reasoning_content === "string"
            ? row.reasoning_content
            : "";
      if (!text && !reasoning) continue;
      const message = ensureAssistant();
      if (text) {
        message.content = message.content ? `${message.content}\n\n${text}` : text;
      }
      if (reasoning) {
        message.reasoning = message.reasoning
          ? `${message.reasoning}\n\n${reasoning}`
          : reasoning;
      }
      continue;
    }

    if (row.role === "tool") {
      const name = row.name || "tool";
      const message = ensureAssistant();
      const subject = formatToolSubject(name, row.context, row.args);
      message.actions = [
        ...(message.actions || []),
        {
          id: row.tool_call_id || `hist_t_${seq++}`,
          type: "",
          label: name,
          subject,
          status: "done",
          output:
            typeof row.content === "string" ? formatToolOutput(row.content) : "",
        },
      ];
    }
  }

  return messages;
}

const CopyMessageButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-[var(--vc-muted-fg)] transition-colors hover:bg-white/[0.05] hover:text-[var(--vc-fg)]"
      title="Salin pesan"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-[var(--vc-primary)]" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      <span>{copied ? "Disalin" : "Salin"}</span>
    </button>
  );
};

const UserMessage: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const { text, images, files } = splitUserAttachments(message.content);
  return (
    <div className="vc-msg flex w-full justify-center px-2 py-2.5 transition-colors sm:px-4">
      <div className="flex w-full max-w-4xl flex-col items-end">
        {text && (
          <div className="max-w-[85%] rounded-2xl border border-[var(--vc-border)] bg-[var(--vc-secondary)] px-3.5 py-2 text-left font-sans text-[14px] leading-snug text-[var(--vc-fg)] sm:max-w-2xl">
            <span className="whitespace-pre-wrap break-words">{text}</span>
          </div>
        )}
        {images.length > 0 && (
          <div className="mt-1.5 flex w-full max-w-[85%] flex-col items-end gap-1.5 sm:max-w-md">
            {images.map((image) => (
              <ManagedImage
                key={image.src}
                src={image.src}
                alt={image.alt}
                explicit
              />
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="mt-1.5 flex w-full max-w-[85%] flex-col items-end gap-1.5 sm:max-w-md">
            {files.map((file) => (
              <span
                key={file.src}
                className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-secondary)] px-2.5 py-1.5 font-sans text-[12px] text-[var(--vc-fg)]"
                title={file.src}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--vc-muted-fg)]" />
                <span className="min-w-0 truncate">{file.name}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase text-[var(--vc-muted-fg)]">
                  {fileExtension(file.name)}
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="vc-msg-toolbar mt-1 flex items-center justify-end pr-0.5">
          <CopyMessageButton text={message.content} />
        </div>
      </div>
    </div>
  );
};

const AssistantMessage: React.FC<{ message: ChatMessage; isLive: boolean }> = ({
  message,
  isLive,
}) => {
  const hasActions = Boolean(message.actions && message.actions.length > 0);
  const reasoning = message.reasoning || "";
  const showStandaloneThinking = Boolean(reasoning) && (isLive || !hasActions);
  // Photos the turn produced (screenshots, generated images): image paths
  // mentioned in the prose or tool outputs render inline, unless already
  // embedded via markdown image syntax.
  const attachedImages = useMemo(() => {
    const embedded = new Set(
      extractMarkdownImageSources(message.content || ""),
    );
    const haystack = [
      message.content || "",
      ...(message.actions || []).map(
        (a) => `${a.output || ""}\n${a.details || ""}`,
      ),
    ].join("\n");
    return extractImagePaths(haystack).filter((p) => !embedded.has(p));
  }, [message.content, message.actions]);

  return (
    <div className="vc-msg flex w-full justify-center px-2 py-2.5 transition-colors sm:px-4">
      <div className="flex w-full max-w-4xl flex-col items-start">
        <div className="w-full text-left">
          {showStandaloneThinking && (
            <ChatThinkingCard reasoning={reasoning} isLive={isLive} />
          )}

          {hasActions &&
            (isLive ? (
              <div className="my-0.5 w-full space-y-0.5">
                {message.actions!.map((action) => (
                  <LiveActionCard key={action.id} action={action} />
                ))}
              </div>
            ) : (
              <ChatOperationSummary
                actions={message.actions!}
                reasoning={reasoning || undefined}
              />
            ))}

          {message.content && (
            <div className="vc-prose mt-1 w-full break-words">
              <Markdown content={message.content} streaming={message.isStreaming} />
            </div>
          )}

          {attachedImages.length > 0 && (
            <div className="mt-1 w-full space-y-1">
              {attachedImages.map((src) => (
                <ManagedImage
                  key={src}
                  src={src}
                  alt={src.split("/").pop() || "Gambar"}
                />
              ))}
            </div>
          )}

          {isLive &&
            !message.content &&
            !reasoning &&
            !hasActions && (
              <div className="flex items-center gap-2 py-1 font-sans text-[11.5px] text-[var(--vc-muted-fg)]">
                <VeeSpinner size={13} />
                <span className="vc-text-shimmer">Menyiapkan jawaban…</span>
              </div>
            )}

          {message.error && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-2.5 py-2 font-sans text-[11.5px] text-red-300">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{message.error}</span>
            </div>
          )}
        </div>

        {!isLive && (message.content || message.error) && (
          <div className="vc-msg-toolbar mt-1 flex items-center gap-1 pl-0.5">
            {message.content && <CopyMessageButton text={message.content} />}
            {message.latencyMs ? (
              <span className="ml-1 font-mono text-[10px] tabular-nums text-[var(--vc-muted-fg)]/60">
                {formatDuration(message.latencyMs)}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

const WORKFLOWS = [
  {
    icon: TerminalIcon,
    label: "Kesehatan Server & Layanan",
    sub: "RAM · disk · proses",
    prompt:
      "Periksa kesehatan server ini: status layanan yang berjalan, penggunaan RAM dan disk, serta proses yang paling banyak memakai resource. Ringkas temuan penting dan rekomendasi tindakannya.",
  },
  {
    icon: Globe,
    label: "Riset Berita & Web Terkini",
    sub: "multi-sumber + ringkasan",
    prompt:
      "Cari berita teknologi dan AI terbaru hari ini dari beberapa sumber terpercaya, lalu rangkum 5 poin utama beserta tautan sumbernya.",
  },
  {
    icon: FolderSearch,
    label: "Audit Repositori Aktif",
    sub: "struktur · dependensi · risiko",
    prompt:
      "Periksa repositori yang sedang aktif: jelaskan struktur proyek, dependensi utama, dan potensi bug atau masalah keamanan yang perlu diperhatikan.",
  },
  {
    icon: Sparkles,
    label: "Otomatisasi Browser",
    sub: "buka halaman + screenshot",
    prompt:
      "Buka https://example.com menggunakan browser, ambil screenshot halaman, lalu jelaskan isi dan struktur halamannya.",
  },
];

function sessionShort(model: string): string {
  if (!model) return "Hermes Agent";
  return model.length > 34 ? `${model.slice(0, 31)}…` : model;
}

interface PendingAttachment {
  id: string;
  kind: "image" | "file";
  name: string;
  size: number;
  previewUrl?: string;
  status: "uploading" | "ready" | "error";
  path?: string;
  error?: string;
}

const MAX_PENDING_ATTACHMENTS = 4;

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pull every dropped/pasted file out of a DataTransfer (deduped). */
function attachableFilesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null) => {
    if (!file) return;
    const key = `${file.name}\0${file.type}\0${file.size}\0${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  if (data.items?.length) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind === "file") add(item.getAsFile());
    }
  }
  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) add(data.files[i]);
  }
  return files;
}

export const VisualChatView: React.FC<VisualChatViewProps> = ({
  scopedProfile,
  resumeSessionId,
  onSessionChange,
  onNewChat,
  onSwitchToTerminal,
  onOpenModelTools,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [title, setTitle] = useState("");
  const [showJump, setShowJump] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const closedByUnmountRef = useRef(false);
  const liveSessionIdRef = useRef("");
  const activeStoredIdRef = useRef<string | null>(null);
  const pendingStoredIdRef = useRef("");
  const loadedResumeRef = useRef<string | null | undefined>(undefined);
  const pendingLoadRef = useRef<{ id: string; resumeId: string | null } | null>(null);
  const requestSeqRef = useRef(0);
  const assistantIdRef = useRef<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const sessionReadyRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const scopedProfileRef = useRef(scopedProfile);
  const onSessionChangeRef = useRef(onSessionChange);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    scopedProfileRef.current = scopedProfile;
  }, [scopedProfile]);
  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);
  useEffect(() => {
    sessionReadyRef.current = sessionReady;
  }, [sessionReady]);
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  const sendRequest = useCallback(
    (method: string, params: Record<string, unknown>): string => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return "";
      const id = `vc_${++requestSeqRef.current}`;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      return id;
    },
    [],
  );

  const dispatchLoad = useCallback(
    (resumeId: string | null) => {
      const profile = scopedProfileRef.current;
      const params: Record<string, unknown> = resumeId
        ? {
            session_id: resumeId,
            ...(profile ? { profile } : {}),
          }
        : {
            source: "tui",
            ...(profile ? { profile } : {}),
          };
      const id = sendRequest(
        resumeId ? "session.resume" : "session.create",
        params,
      );
      if (!id) return;
      pendingLoadRef.current = { id, resumeId };
    },
    [sendRequest],
  );

  const beginSession = useCallback(
    (resumeId: string | null) => {
      setMessages([]);
      setLoadError(null);
      setSessionReady(false);
      setIsGenerating(false);
      setModel("");
      setTitle(resumeId ? "" : "Sesi Baru");
      liveSessionIdRef.current = "";
      assistantIdRef.current = null;
      pendingStoredIdRef.current = "";
      activeStoredIdRef.current = resumeId;
      pendingLoadRef.current = null;

      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        pendingLoadRef.current = { id: "", resumeId };
        return;
      }
      dispatchLoad(resumeId);
    },
    [dispatchLoad],
  );

  const hydrateFromRest = useCallback(async (resumeId: string) => {
    const liveAtStart = liveSessionIdRef.current;
    try {
      const response = await api.getSessionMessages(
        resumeId,
        scopedProfileRef.current,
      );
      if (liveSessionIdRef.current !== liveAtStart) return;
      const projected = projectHistory(
        (response.messages || []) as unknown as HistoryRow[],
      );
      if (projected.length === 0) return;
      setMessages((previous) => (previous.length === 0 ? projected : previous));
    } catch {
      // Best-effort: a live/unpersisted child has no REST row yet.
    }
  }, []);

  const refreshSessionMeta = useCallback((sessionId: string) => {
    if (!sessionId) return;
    void api
      .getSessionDetail(sessionId, scopedProfileRef.current)
      .then((session) => {
        if (
          activeStoredIdRef.current &&
          activeStoredIdRef.current !== sessionId
        ) {
          return;
        }
        const nextTitle = normalizeSessionTitle(session.title);
        if (nextTitle) setTitle(nextTitle);
        if (session.model) setModel(session.model);
      })
      .catch(() => {
        // Best-effort: a freshly minted session has no row until its first turn.
      });
  }, []);

  const handleLoadResult = useCallback(
    (frame: RpcFrame) => {
      const pending = pendingLoadRef.current;
      if (!pending || frame.id !== pending.id) return;
      pendingLoadRef.current = null;

      if (frame.error) {
        setLoadError(frame.error.message || "Gagal memuat sesi.");
        setSessionReady(false);
        return;
      }

      const result = frame.result || {};
      const liveId = result.session_id || "";
      liveSessionIdRef.current = liveId;

      if (pending.resumeId) {
        activeStoredIdRef.current = pending.resumeId;
        loadedResumeRef.current = pending.resumeId;
        setTitle(result.info?.title || "");
        refreshSessionMeta(pending.resumeId);
      } else {
        pendingStoredIdRef.current = result.stored_session_id || "";
        activeStoredIdRef.current = null;
        loadedResumeRef.current = null;
        setTitle(result.info?.title || "Sesi Baru");
      }

      setModel(result.info?.model || "");
      const history = projectHistory(result.messages || []);
      setMessages(history);
      setSessionReady(true);

      if (result.running) {
        const lastAssistant = [...history]
          .reverse()
          .find((message) => message.role === "assistant");
        assistantIdRef.current = lastAssistant?.id || null;
        setIsGenerating(true);
      } else {
        setIsGenerating(false);
      }

      if (history.length === 0 && (result.message_count || 0) > 0) {
        void hydrateFromRest(pending.resumeId || activeStoredIdRef.current || "");
      }
    },
    [hydrateFromRest, refreshSessionMeta],
  );

  const submitPrompt = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text || isGeneratingRef.current) return;
      const sessionId = liveSessionIdRef.current;
      if (!sessionId) {
        pendingPromptRef.current = text;
        return;
      }

      const now = Date.now();
      const assistantId = `asst_${now}_${Math.random().toString(36).slice(2, 7)}`;
      assistantIdRef.current = assistantId;

      setMessages((previous) => [
        // A new turn settles every earlier response: no spinner/shimmer from
        // a previous turn may run again once the next response starts.
        ...previous.map((message) =>
          message.role === "assistant"
            ? {
                ...message,
                isStreaming: false,
                actions: message.actions
                  ? settleActions(message.actions)
                  : message.actions,
              }
            : message,
        ),
        {
          id: `usr_${now}`,
          role: "user",
          content: text,
        },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          reasoning: "",
          actions: [],
          isStreaming: true,
          startedAt: now,
        },
      ]);
      setIsGenerating(true);
      stickToBottomRef.current = true;
      sendRequest("prompt.submit", { session_id: sessionId, text });
    },
    [sendRequest],
  );

  const ensureAssistant = useCallback((): string => {
    if (assistantIdRef.current) return assistantIdRef.current;
    const id = `asst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    assistantIdRef.current = id;
    setMessages((previous) => [
      ...previous,
      {
        id,
        role: "assistant",
        content: "",
        reasoning: "",
        actions: [],
        isStreaming: true,
        startedAt: Date.now(),
      },
    ]);
    return id;
  }, []);

  const updateAssistant = useCallback(
    (updater: (message: ChatMessage) => ChatMessage) => {
      const id = ensureAssistant();
      setMessages((previous) =>
        previous.map((message) => (message.id === id ? updater(message) : message)),
      );
    },
    [ensureAssistant],
  );

  const handleEvent = useCallback(
    (event: RpcEventPayload) => {
      if (!event || typeof event.type !== "string") return;
      if (
        liveSessionIdRef.current &&
        event.session_id &&
        event.session_id !== liveSessionIdRef.current
      ) {
        return;
      }

      const payload = event.payload || {};
      const type = event.type;

      if (type === "thinking.delta" || type === "reasoning.delta") {
        const delta = typeof payload.text === "string" ? payload.text : "";
        if (!delta.trim()) return;
        updateAssistant((message) => ({
          ...message,
          reasoning: `${message.reasoning || ""}${delta}`,
          isStreaming: true,
        }));
        return;
      }

      if (type === "reasoning.available") {
        const text = typeof payload.text === "string" ? payload.text : "";
        if (!text.trim()) return;
        updateAssistant((message) =>
          (message.reasoning || "").trim()
            ? message
            : { ...message, reasoning: text },
        );
        return;
      }

      if (type === "tool.start") {
        const name = payload.name || "tool";
        const toolId = payload.tool_id || `tool_${Date.now()}`;
        const action: ActionInfo = {
          id: toolId,
          type: "",
          label: name,
          subject: formatToolSubject(name, payload.context, payload.args),
          status: "running",
          startedAt: Date.now(),
        };
        updateAssistant((message) => ({
          ...message,
          isStreaming: true,
          actions: [...(message.actions || []), action],
        }));
        return;
      }

      if (type === "tool.complete") {
        const name = payload.name || "tool";
        const toolId = payload.tool_id || "";
        const output = formatToolOutput(payload.result);
        const isError =
          Boolean(payload.error) ||
          payload.status === "error" ||
          isToolResultError(payload.result);
        const durationMs =
          typeof payload.duration_s === "number"
            ? Math.round(payload.duration_s * 1000)
            : undefined;
        const subject = formatToolSubject(name, payload.context, payload.args);

        updateAssistant((message) => {
          const actions = [...(message.actions || [])];
          const index = actions.findIndex((action) => action.id === toolId);
          if (index >= 0) {
            const current = actions[index];
            actions[index] = {
              ...current,
              status: "done",
              isError,
              output,
              subject: subject || current.subject,
              durationMs:
                durationMs ??
                (current.startedAt ? Date.now() - current.startedAt : undefined),
            };
          } else {
            actions.push({
              id: toolId || `tool_${Date.now()}`,
              type: "",
              label: name,
              subject,
              status: "done",
              output,
              isError,
              durationMs,
            });
          }
          return { ...message, actions };
        });
        return;
      }

      if (type === "message.delta") {
        const delta = typeof payload.text === "string" ? payload.text : "";
        if (!delta) return;
        updateAssistant((message) => ({
          ...message,
          content: `${message.content || ""}${delta}`,
          isStreaming: true,
        }));
        return;
      }

      if (type === "message.complete") {
        const id = ensureAssistant();
        const finalText = typeof payload.text === "string" ? payload.text : "";
        const failed = payload.status === "error";
        setIsGenerating(false);

        setMessages((previous) =>
          previous.map((message) => {
            if (message.id !== id) return message;
            const content = message.content || finalText;
            return {
              ...message,
              content,
              isStreaming: false,
              actions: message.actions
                ? settleActions(message.actions)
                : message.actions,
              latencyMs: message.startedAt
                ? Date.now() - message.startedAt
                : undefined,
              error: failed
                ? payload.error || payload.message || "Terjadi kesalahan pada model."
                : undefined,
            };
          }),
        );

        assistantIdRef.current = null;

        if (!activeStoredIdRef.current && pendingStoredIdRef.current) {
          activeStoredIdRef.current = pendingStoredIdRef.current;
          loadedResumeRef.current = pendingStoredIdRef.current;
          onSessionChangeRef.current?.(pendingStoredIdRef.current);
        }
        const storedId =
          activeStoredIdRef.current || pendingStoredIdRef.current;
        if (storedId) {
          refreshSessionMeta(storedId);
          window.setTimeout(() => refreshSessionMeta(storedId), 1200);
        }
        return;
      }

      if (type === "session.info") {
        if (typeof payload.model === "string" && payload.model.trim()) {
          setModel(payload.model);
        }
        if (typeof payload.title === "string" && payload.title.trim()) {
          setTitle(payload.title);
        }
        if (
          typeof payload.stored_session_id === "string" &&
          payload.stored_session_id &&
          !activeStoredIdRef.current
        ) {
          pendingStoredIdRef.current = payload.stored_session_id;
        }
        return;
      }

      if (type === "error") {
        const text = payload.message || payload.error || "Terjadi kesalahan.";
        setIsGenerating(false);
        updateAssistant((message) => ({
          ...message,
          isStreaming: false,
          actions: message.actions
            ? settleActions(message.actions)
            : message.actions,
          error: text,
        }));
      }
    },
    [ensureAssistant, refreshSessionMeta, updateAssistant],
  );

  const handleFrame = useCallback(
    (frame: RpcFrame) => {
      if (frame.method === "event") {
        if (frame.params) handleEvent(frame.params);
        return;
      }
      if (frame.id && pendingLoadRef.current?.id === frame.id) {
        handleLoadResult(frame);
        return;
      }
      if (frame.error) {
        setIsGenerating(false);
        updateAssistant((message) => ({
          ...message,
          isStreaming: false,
          actions: message.actions
            ? settleActions(message.actions)
            : message.actions,
          error: frame.error?.message || "Permintaan gagal diproses.",
        }));
      }
    },
    [handleEvent, handleLoadResult, updateAssistant],
  );

  const handleFrameRef = useRef(handleFrame);
  useEffect(() => {
    handleFrameRef.current = handleFrame;
  }, [handleFrame]);

  useEffect(() => {
    closedByUnmountRef.current = false;
    let cancelled = false;

    const open = async (): Promise<void> => {
      if (cancelled || closedByUnmountRef.current) return;
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      let url: string;
      try {
        url = await api.buildWsUrl("/api/ws");
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Tidak dapat membuka koneksi.",
        );
        return;
      }

      if (cancelled || closedByUnmountRef.current) return;

      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        setLoadError(null);
        reconnectAttemptsRef.current = 0;

        if (pendingLoadRef.current) {
          const resumeId = pendingLoadRef.current.resumeId;
          pendingLoadRef.current = null;
          dispatchLoad(resumeId);
          return;
        }
        if (activeStoredIdRef.current) {
          dispatchLoad(activeStoredIdRef.current);
          return;
        }
        if (!liveSessionIdRef.current) {
          dispatchLoad(null);
        }
      };

      socket.onmessage = (event) => {
        try {
          handleFrameRef.current(JSON.parse(event.data) as RpcFrame);
        } catch (error) {
          console.error("[VisualChatView] parse error", error);
        }
      };

      socket.onerror = () => {
        setIsConnected(false);
      };

      socket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (cancelled || closedByUnmountRef.current) return;
        const attempt = reconnectAttemptsRef.current;
        if (attempt >= 6) return;
        reconnectAttemptsRef.current = attempt + 1;
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          void open();
        }, Math.min(1000 * 2 ** attempt, 8000));
      };
    };

    void open();

    return () => {
      cancelled = true;
      closedByUnmountRef.current = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [dispatchLoad]);

  useEffect(() => {
    const desired = resumeSessionId || null;
    if (loadedResumeRef.current === desired) return;
    loadedResumeRef.current = desired;
    beginSession(desired);
  }, [resumeSessionId, beginSession]);

  const scrollToBottom = useCallback((smooth = false) => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current = true;
    setShowJump(false);
    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance < 80;
    stickToBottomRef.current = atBottom;
    setShowJump(!atBottom);
  }, []);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((previous) => {
      const removed = previous.find((item) => item.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return previous.filter((item) => item.id !== id);
    });
  }, []);

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
  }, []);

  const addAttachFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const room = Math.max(
        0,
        MAX_PENDING_ATTACHMENTS - pendingAttachments.length,
      );
      const picked = files.slice(0, room);
      if (!picked.length) return;
      const profile = scopedProfileRef.current || "";
      const items: PendingAttachment[] = picked.map((file) => {
        const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const isImage =
          file.type.startsWith("image/") || isImageFileName(file.name);
        if (!isImage && !isDocFileName(file.name)) {
          return {
            id,
            kind: "file" as const,
            name: file.name || "file",
            size: file.size,
            status: "error" as const,
            error: "Format tidak didukung",
          };
        }
        return {
          id,
          kind: isImage ? ("image" as const) : ("file" as const),
          name: file.name || (isImage ? "foto" : "file"),
          size: file.size,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
          status: "uploading" as const,
        };
      });
      setPendingAttachments((previous) => [...previous, ...items]);
      items.forEach((item, index) => {
        if (item.status === "error") return;
        const file = picked[index];
        const uploaded =
          item.kind === "image"
            ? uploadChatImage(file, profile).then((result) => ({
                path: result.path,
                name: result.name,
              }))
            : uploadChatFile(file).then((result) => ({
                path: result.path,
                name: result.name,
              }));
        void uploaded
          .then((result) => {
            setPendingAttachments((current) =>
              current.map((entry) =>
                entry.id === item.id
                  ? {
                      ...entry,
                      status: "ready",
                      path: result.path,
                      name: result.name,
                    }
                  : entry,
              ),
            );
          })
          .catch((err: unknown) => {
            setPendingAttachments((current) =>
              current.map((entry) =>
                entry.id === item.id
                  ? {
                      ...entry,
                      status: "error",
                      error:
                        err instanceof Error ? err.message : "Upload gagal",
                    }
                  : entry,
              ),
            );
          });
      });
    },
    [pendingAttachments.length],
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    const ready = pendingAttachments.filter(
      (item) => item.status === "ready" && item.path,
    );
    const uploading = pendingAttachments.some(
      (item) => item.status === "uploading",
    );
    if ((!text && !ready.length) || isGenerating || uploading) return;
    // Attachments travel as path lines: photos as markdown image lines, files
    // as bare server paths. The agent receives the path, and the user's own
    // bubble renders the photo inline / the file as a chip.
    const lines = ready.map((item) =>
      item.kind === "image" ? `![${item.name}](${item.path})` : item.path!,
    );
    const fullText = [text, ...lines].filter(Boolean).join("\n");
    setInput("");
    clearPendingAttachments();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    if (!sessionReadyRef.current || !liveSessionIdRef.current) {
      pendingPromptRef.current = fullText;
      return;
    }
    submitPrompt(fullText);
  }, [
    input,
    isGenerating,
    pendingAttachments,
    submitPrompt,
    clearPendingAttachments,
  ]);

  const handleStop = useCallback(() => {
    const sessionId = liveSessionIdRef.current;
    if (!sessionId) return;
    sendRequest("session.interrupt", { session_id: sessionId });
    setIsGenerating(false);
    setMessages((previous) =>
      previous.map((message) =>
        message.id === assistantIdRef.current
          ? {
              ...message,
              isStreaming: false,
              actions: message.actions
                ? settleActions(message.actions)
                : message.actions,
            }
          : message,
      ),
    );
  }, [sendRequest]);

  const handleNewChat = useCallback(() => {
    if (isGeneratingRef.current && liveSessionIdRef.current) {
      sendRequest("session.interrupt", {
        session_id: liveSessionIdRef.current,
      });
    }
    loadedResumeRef.current = null;
    activeStoredIdRef.current = null;
    clearPendingAttachments();
    beginSession(null);
    onNewChat?.();
  }, [beginSession, onNewChat, sendRequest, clearPendingAttachments]);

  const handleRetryLoad = useCallback(() => {
    beginSession(loadedResumeRef.current ?? null);
  }, [beginSession]);

  const handleQuickWorkflow = useCallback(
    (prompt: string) => {
      setInput("");
      if (!sessionReadyRef.current || !liveSessionIdRef.current) {
        pendingPromptRef.current = prompt;
        return;
      }
      submitPrompt(prompt);
    },
    [submitPrompt],
  );

  const handleComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    const queued = pendingPromptRef.current;
    if (!queued || !sessionReady || !liveSessionIdRef.current) return;
    pendingPromptRef.current = null;
    submitPrompt(queued);
  }, [sessionReady, submitPrompt]);

  const userCount = useMemo(
    () => messages.filter((message) => message.role === "user").length,
    [messages],
  );

  const loading = !sessionReady && messages.length === 0;
  const lastMessageIndex = messages.length - 1;

  return (
    <div className="veechat flex h-full w-full flex-col overflow-hidden bg-[var(--vc-bg)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--vc-border)] px-3 py-1.5 sm:px-5 sm:py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isConnected
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]"
                : "bg-amber-400"
            }`}
          />
          <div className="min-w-0">
            <div className="truncate font-sans text-[12.5px] font-medium text-[var(--vc-fg)]">
              {title || (resumeSessionId ? "Percakapan" : "Sesi Baru")}
            </div>
            <div className="hidden items-center gap-1.5 font-sans text-[10px] text-[var(--vc-muted-fg)] sm:flex">
              <span className="inline-flex items-center gap-1">
                <Cpu className="h-2.5 w-2.5" />
                {sessionShort(model)}
              </span>
              <span className="opacity-40">·</span>
              <span>
                {isConnected
                  ? isGenerating
                    ? "Sedang bekerja"
                    : "Siap"
                  : "Menyambungkan…"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onOpenModelTools && (
            <button
              type="button"
              onClick={onOpenModelTools}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--vc-border)] bg-[var(--vc-card)] text-[var(--vc-fg)] transition-colors hover:bg-[var(--vc-secondary)] sm:hidden"
              title="Model & tools"
              aria-label="Model & tools"
            >
              <PanelRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-card)] px-2.5 py-1 font-sans text-[11px] font-medium text-[var(--vc-fg)] transition-colors hover:bg-[var(--vc-secondary)]"
            title="Mulai sesi chat baru"
          >
            <Plus className="h-3.5 w-3.5 text-[var(--vc-primary)]" />
            <span className="hidden min-[520px]:inline">Sesi Baru</span>
          </button>

          <div className="flex items-center rounded-lg border border-[var(--vc-border)] bg-[var(--vc-sidebar)] p-0.5 font-sans text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--vc-secondary)] px-2 py-0.5 font-semibold text-[var(--vc-fg)] shadow-sm">
              <Sparkles className="h-3 w-3 text-[var(--vc-primary)]" />
              <span>Visual</span>
            </span>
            {onSwitchToTerminal && (
              <button
                type="button"
                onClick={onSwitchToTerminal}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[var(--vc-muted-fg)] transition-colors hover:bg-[var(--vc-secondary)]/60 hover:text-[var(--vc-fg)]"
                title="Beralih ke terminal CLI"
              >
                <TerminalIcon className="h-3 w-3" />
                <span>CLI</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto overscroll-contain"
        >
          {loading ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              {loadError ? (
                <>
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 font-sans text-xs text-red-300">
                    {loadError}
                  </div>
                  <button
                    type="button"
                    onClick={handleRetryLoad}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--vc-primary)] px-3 py-1.5 font-sans text-xs font-semibold text-white transition-colors hover:bg-[var(--vc-primary-hover)]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Coba lagi
                  </button>
                </>
              ) : (
                <>
                  <VeeSpinner size={22} className="text-[var(--vc-primary)]" />
                  <div className="font-sans text-xs text-[var(--vc-muted-fg)]">
                    Menyiapkan sesi visual…
                  </div>
                </>
              )}
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-8 font-sans sm:px-6">
              <div className="space-y-2.5 pb-4 text-left">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-card)] px-2.5 py-1 font-medium text-[var(--vc-fg)]">
                    <Cpu className="h-3.5 w-3.5 text-[var(--vc-primary)]" />
                    {sessionShort(model)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-card)] px-2.5 py-1 font-medium text-[var(--vc-fg)]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--vc-primary)]" />
                    Tool aktif
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-card)] px-2.5 py-1 font-medium text-[var(--vc-fg)]">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--vc-primary)]" />
                    Visual mode
                  </span>
                </div>

                <h2 className="vc-serif pt-1 text-xl font-semibold tracking-tight text-[var(--vc-fg)] sm:text-2xl">
                  Ruang Kerja Teknis &amp; Otomasi
                </h2>
                <p className="max-w-xl text-[11.5px] leading-relaxed text-[var(--vc-muted-fg)]">
                  Pilih alur cepat di bawah atau tulis instruksi langsung. Hermes akan
                  menampilkan pemikiran, aksi tool, dan hasilnya secara real-time.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {WORKFLOWS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handleQuickWorkflow(item.prompt)}
                    className="group flex items-center gap-3 rounded-xl border border-[var(--vc-border)] bg-[var(--vc-card)]/80 p-3 text-left transition-colors hover:border-[rgb(204_120_92_/_0.5)] hover:bg-[var(--vc-secondary)]/50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgb(204_120_92_/_0.2)] bg-[rgb(204_120_92_/_0.1)] text-[var(--vc-primary)]">
                      <item.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-[var(--vc-fg)] transition-colors group-hover:text-[var(--vc-primary)]">
                        {item.label}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-[var(--vc-muted-fg)]">
                        {item.sub}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <UserMessage key={message.id} message={message} />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isLive={
                      Boolean(message.isStreaming) ||
                      (isGenerating && index === lastMessageIndex)
                    }
                  />
                ),
              )}
              <div className="h-4" />
            </div>
          )}
        </div>

        {showJump && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--vc-border)] bg-[var(--vc-card)]/95 px-3 py-1.5 font-sans text-[10.5px] font-medium text-[var(--vc-fg)] shadow-lg backdrop-blur transition-colors hover:border-[rgb(204_120_92_/_0.5)]"
          >
            <ArrowDown className="h-3.5 w-3.5 text-[var(--vc-primary)]" />
            Pesan terbaru
          </button>
        )}
      </div>

      <div className="shrink-0 px-2 pb-3 pt-1 sm:px-4">
        <div className="mx-auto w-full max-w-4xl">
          <form
            className="vc-composer rounded-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend();
            }}
            onPaste={(event) => {
              const files = attachableFilesFromTransfer(event.clipboardData);
              if (files.length) {
                event.preventDefault();
                addAttachFiles(files);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer?.types?.includes("Files")) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => {
              const files = attachableFilesFromTransfer(event.dataTransfer);
              if (files.length) {
                event.preventDefault();
                addAttachFiles(files);
              }
            }}
          >
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap items-start gap-2 px-3.5 pt-2.5">
                {pendingAttachments.map((item) =>
                  item.kind === "image" ? (
                    <div
                      key={item.id}
                      className="relative h-14 w-14 shrink-0"
                      title={item.status === "error" ? item.error : item.name}
                    >
                      {item.previewUrl && (
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          className={`h-14 w-14 rounded-lg border border-[var(--vc-border)] object-cover ${
                            item.status === "uploading" ? "opacity-50" : ""
                          }`}
                        />
                      )}
                      {item.status === "uploading" && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--vc-muted-fg)] border-t-transparent" />
                        </span>
                      )}
                      {item.status === "error" && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/20 font-sans text-[9px] font-medium text-red-400">
                          Gagal
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(item.id)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--vc-secondary)] text-[var(--vc-fg)] shadow"
                        title="Hapus lampiran"
                        aria-label="Hapus lampiran"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div
                      key={item.id}
                      className="relative flex h-14 max-w-[16rem] min-w-0 items-center gap-2 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-secondary)] px-2.5"
                      title={item.status === "error" ? item.error : item.name}
                    >
                      {item.status === "uploading" ? (
                        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--vc-muted-fg)] border-t-transparent" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-[var(--vc-muted-fg)]" />
                      )}
                      <div className="min-w-0 font-sans">
                        <div className="truncate text-[12px] leading-tight text-[var(--vc-fg)]">
                          {item.name}
                        </div>
                        <div
                          className={`text-[10px] leading-tight ${
                            item.status === "error"
                              ? "text-red-400"
                              : "text-[var(--vc-muted-fg)]"
                          }`}
                        >
                          {item.status === "error"
                            ? (item.error ?? "Gagal")
                            : item.status === "uploading"
                              ? "Mengunggah…"
                              : formatAttachmentSize(item.size)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(item.id)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--vc-card)] text-[var(--vc-fg)] shadow"
                        title="Hapus lampiran"
                        aria-label="Hapus lampiran"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
            <div className="px-3.5 pb-1 pt-2.5">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Kirim instruksi ke Hermes…"
                rows={1}
                className="max-h-[180px] w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--vc-fg)] outline-none placeholder:text-[var(--vc-muted-fg)]/60"
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
              <div className="flex min-w-0 items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ATTACH_ACCEPT}
                  multiple
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    addAttachFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--vc-muted-fg)] transition-colors hover:bg-white/[0.05] hover:text-[var(--vc-fg)]"
                  title="Lampirkan foto atau file"
                  aria-label="Lampirkan foto atau file"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <span
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 font-sans text-[11px] font-medium text-[var(--vc-muted-fg)]"
                  title={model || "Hermes Agent"}
                >
                  <Cpu className="h-3.5 w-3.5 text-[var(--vc-primary)]" />
                  <span className="max-w-[10rem] truncate">
                    {sessionShort(model)}
                  </span>
                </span>
                {userCount > 0 && (
                  <span className="hidden items-center gap-1 rounded-lg px-2 font-mono text-[10px] text-[var(--vc-muted-fg)]/70 sm:inline-flex">
                    {userCount} giliran
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <span className="hidden font-sans text-[10px] text-[var(--vc-muted-fg)]/70 sm:inline">
                  Enter kirim · Shift+Enter baris baru
                </span>
                {isGenerating ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="inline-flex h-7 items-center gap-1 rounded-lg bg-red-500 px-2.5 font-sans text-[11px] font-medium text-white transition-colors hover:bg-red-400"
                    title="Hentikan proses"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    <span>Hentikan</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      (!input.trim() &&
                        !pendingAttachments.some(
                          (item) => item.status === "ready",
                        )) ||
                      pendingAttachments.some(
                        (item) => item.status === "uploading",
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--vc-primary)] text-white transition-colors hover:bg-[var(--vc-primary-hover)] disabled:pointer-events-none disabled:opacity-30"
                    title="Kirim pesan"
                  >
                    <ArrowUp className="h-4 w-4 stroke-[2.4]" />
                  </button>
                )}
              </div>
            </div>
          </form>

          <div className="flex items-center justify-between px-1 pt-1.5 font-sans text-[10px] text-[var(--vc-muted-fg)]/70">
            <span className="inline-flex items-center gap-1.5">
              <Wrench className="h-3 w-3" />
              Live action · tool timeline
            </span>
            <span>
              {isConnected ? "Terhubung" : "Menyambungkan…"}
              {sessionReady ? "" : " · memuat"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
