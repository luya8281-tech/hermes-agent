import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Square,
  Bot,
  Sparkles,
  Terminal as TerminalIcon,
  PlusCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
} from "lucide-react";
import { LiveActionCard, type ActionInfo } from "./LiveActionCard";
import { Markdown } from "./Markdown";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  actions?: ActionInfo[];
  isStreaming?: boolean;
}

export interface VisualChatViewProps {
  channel?: string;
  scopedProfile?: string;
  resumeSessionId?: string | null;
  onSessionChange?: (sessionId: string) => void;
  onSwitchToTerminal?: () => void;
}

function mapToolType(toolName: string) {
  const lower = (toolName || "").toLowerCase();
  if (lower === "terminal" || lower.includes("bash") || lower.includes("shell")) {
    return { label: "BASH", cls: "bash" };
  }
  if (lower.startsWith("mcp__simular_box__")) {
    return { label: "SIMULAR", cls: "simular" };
  }
  if (lower.includes("web_search") || lower.includes("search")) {
    return { label: "SEARCH", cls: "web" };
  }
  if (lower.includes("web_extract") || lower.includes("buka_web") || lower.includes("fetch")) {
    return { label: "WEB", cls: "web" };
  }
  if (
    lower.includes("read_file") ||
    lower.includes("write_file") ||
    lower.includes("patch") ||
    lower.includes("search_files")
  ) {
    return { label: "WORKSPACE", cls: "file" };
  }
  if (lower.includes("browser")) {
    return { label: "BROWSER", cls: "simular" };
  }
  return { label: (toolName || "TOOL").toUpperCase(), cls: "tool" };
}

function formatSubject(toolName: string, context?: any, args?: any): string {
  if (context && typeof context === "string" && context.trim()) {
    return context.trim();
  }
  if (args) {
    if (typeof args === "string") return args.slice(0, 100);
    if (args.command) return String(args.command);
    if (args.path) return String(args.path);
    if (args.query) return String(args.query);
    if (args.url) return String(args.url);
    try {
      return JSON.stringify(args).slice(0, 100);
    } catch {
      return toolName;
    }
  }
  return toolName || "tool";
}

function formatOutput(res: any): string {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (res.output) return String(res.output);
  if (res.content) return String(res.content);
  try {
    return JSON.stringify(res, null, 2);
  } catch {
    return String(res);
  }
}

export const VisualChatView: React.FC<VisualChatViewProps> = ({
  resumeSessionId,
  onSessionChange,
  onSwitchToTerminal,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [sessionId, setSessionId] = useState<string>(resumeSessionId || "");
  const [isConnected, setIsConnected] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState<Record<string, boolean>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentTurnRef = useRef<ChatMessage | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Connect WebSocket to /api/ws
  useEffect(() => {
    const token = (window as any).__HERMES_SESSION_TOKEN__ || "";
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/api/ws?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      if (!sessionId) {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "init_session",
            method: "session.create",
            params: {},
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "history_session",
            method: "session.history",
            params: { session_id: sessionId },
          })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle session.create response
        if (data.id === "init_session" && data.result?.session_id) {
          const sid = data.result.session_id;
          setSessionId(sid);
          if (onSessionChange) onSessionChange(sid);
          return;
        }

        // Handle session.history response
        if (data.id === "history_session" && data.result?.messages) {
          const past: ChatMessage[] = data.result.messages.map((m: any, idx: number) => ({
            id: `hist_${idx}`,
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content || m.text || "",
            actions: [],
          }));
          if (past.length > 0) {
            setMessages(past);
          }
          return;
        }

        // Handle streaming events
        if (data.params && typeof data.params === "object") {
          const type = data.params.type;
          const payload = data.params.payload || {};

          // 1. Thinking / Reasoning
          if (type === "thinking.delta" || type === "reasoning.delta") {
            const delta = payload.text || "";
            if (delta) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  last.reasoning = (last.reasoning || "") + delta;
                }
                return next;
              });
            }
          }

          // 2. Tool Start -> add LiveActionCard
          else if (type === "tool.start") {
            const toolId = payload.tool_id || `tool_${Date.now()}`;
            const name = payload.name || "tool";
            const typeInfo = mapToolType(name);
            const subject = formatSubject(name, payload.context, payload.args);

            const newAction: ActionInfo = {
              id: toolId,
              label: name,
              type: typeInfo.label,
              subject: subject,
              status: "running",
              startedAt: Date.now(),
            };

            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.actions = [...(last.actions || []), newAction];
              }
              return next;
            });
          }

          // 3. Tool Complete -> finalize LiveActionCard
          else if (type === "tool.complete") {
            const toolId = payload.tool_id;
            const durationMs =
              payload.duration_s !== undefined ? Math.round(payload.duration_s * 1000) : 0;
            const output = formatOutput(payload.result);
            const isError = Boolean(payload.result?.error || payload.error);

            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last.actions) {
                last.actions = last.actions.map((act) => {
                  if (act.id === toolId) {
                    return {
                      ...act,
                      status: "done",
                      durationMs,
                      output,
                      details: output,
                      isError,
                    };
                  }
                  return act;
                });
              }
              return next;
            });
          }

          // 4. Message Delta -> stream token
          else if (type === "message.delta") {
            const delta = payload.text || "";
            if (delta) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  last.content = (last.content || "") + delta;
                }
                return next;
              });
            }
          }

          // 5. Message Complete -> finish turn
          else if (type === "message.complete") {
            setIsGenerating(false);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.isStreaming = false;
              }
              return next;
            });
          }

          // 6. Error event
          else if (type === "error") {
            setIsGenerating(false);
            const errText = payload.message || "Error during execution";
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                last.content = (last.content || "") + `\n\n> ⚠️ **Error:** ${errText}`;
                last.isStreaming = false;
              }
              return next;
            });
          }
        }
      } catch (err) {
        console.error("[VisualChatView] Parse error:", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId, onSessionChange]);

  const handleSend = () => {
    if (!input.trim() || isGenerating || !wsRef.current || !isConnected) return;
    const text = input.trim();
    setInput("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMessage: ChatMessage = {
      id: `usr_${Date.now()}`,
      role: "user",
      content: text,
    };

    const assistantTurn: ChatMessage = {
      id: `asst_${Date.now()}`,
      role: "assistant",
      content: "",
      reasoning: "",
      actions: [],
      isStreaming: true,
    };

    currentTurnRef.current = assistantTurn;
    setMessages((prev) => [...prev, userMessage, assistantTurn]);
    setIsGenerating(true);

    wsRef.current.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: `submit_${Date.now()}`,
        method: "prompt.submit",
        params: {
          session_id: sessionId,
          text: text,
        },
      })
    );
  };

  const handleStop = () => {
    if (!isGenerating || !wsRef.current || !sessionId) return;
    wsRef.current.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: `stop_${Date.now()}`,
        method: "session.interrupt",
        params: { session_id: sessionId },
      })
    );
    setIsGenerating(false);
  };

  const handleNewChat = () => {
    if (wsRef.current && isConnected) {
      setMessages([]);
      wsRef.current.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "init_session",
          method: "session.create",
          params: {},
        })
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleThinking = (id: string) => {
    setThinkingOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 rounded-lg overflow-hidden border border-slate-800">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 backdrop-blur shrink-0 text-xs">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-400"
              }`}
            />
            <span>{isConnected ? "Online · Siap" : "Menghubungkan..."}</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-slate-400">
            <span className="inline-flex items-center gap-1 text-slate-300 font-medium">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              Hermes Agent
            </span>
            <span>·</span>
            <span className="text-slate-400">9Router (Gemini Flash)</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* New Chat Button */}
          <button
            onClick={handleNewChat}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            title="Mulai Sesi Chat Baru"
          >
            <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden min-[500px]:inline">Sesi Baru</span>
          </button>

          {/* Mode Switcher */}
          <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-slate-800">
            <button
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold text-xs bg-emerald-600 text-white shadow-sm"
              title="Tampilan Visual Modern"
            >
              <Sparkles className="w-3 h-3 text-emerald-200" />
              <span>Visual</span>
            </button>
            {onSwitchToTerminal && (
              <button
                onClick={onSwitchToTerminal}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
                title="Beralih ke Terminal CLI Asli"
              >
                <TerminalIcon className="w-3 h-3" />
                <span>CLI</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-4 my-auto py-12">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20">
              <Bot className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-white">Hermes Autonomous Agent</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tampilan chat visual modern dengan kartu <strong>LiveActionCard</strong>, hitungan
                detik eksekusi tool, dan alur pemikiran real-time.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {[
                "Cek direktori dan status server VPS",
                "Buka browser ZenRows dan cek koneksi",
                "Jalankan uptime terminal dan memory",
                "Cari berita AI terbaru di internet",
              ].map((pill, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(pill);
                    if (textareaRef.current) textareaRef.current.focus();
                  }}
                  className="px-3 py-1.5 rounded-full bg-slate-900 hover:bg-emerald-950/60 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-300 hover:text-emerald-300 transition-colors"
                >
                  {pill}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="w-full">
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-slate-800 border border-slate-700/60 text-slate-100 px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2.5 max-w-full">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <Bot className="w-4 h-4" />
                    <span>Hermes Agent</span>
                  </div>

                  {/* Thinking Section */}
                  {msg.reasoning && (
                    <div className="w-full rounded-lg border border-slate-800/80 bg-slate-900/50 overflow-hidden text-xs">
                      <div
                        onClick={() => toggleThinking(msg.id)}
                        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none text-slate-400 hover:text-slate-200"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                          Alur Pemikiran (Reasoning)
                        </span>
                        {thinkingOpen[msg.id] ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </div>
                      {thinkingOpen[msg.id] && (
                        <div className="p-3 border-t border-slate-800 font-mono text-[11.5px] leading-relaxed text-slate-400 bg-black/40 max-h-56 overflow-y-auto whitespace-pre-wrap break-all">
                          {msg.reasoning}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Live Action Timeline */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="w-full space-y-2 my-1">
                      {msg.actions.map((act) => (
                        <LiveActionCard key={act.id} action={act} />
                      ))}
                    </div>
                  )}

                  {/* Markdown Answer */}
                  {msg.content ? (
                    <div className="w-full text-sm leading-relaxed text-slate-200">
                      <Markdown content={msg.content} streaming={msg.isStreaming} />
                    </div>
                  ) : msg.isStreaming ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 py-1">
                      <div className="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                      <span>Sedang memproses...</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Bar */}
      <div className="p-3 sm:p-4 bg-slate-900/95 border-t border-slate-800 backdrop-blur shrink-0 space-y-2">
        <div className="flex items-end gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500/30 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Tanyakan apa saja atau perintahkan Hermes menjalankan tool..."
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm text-slate-100 placeholder-slate-500 leading-relaxed max-h-44 py-1"
          />
          {isGenerating ? (
            <button
              onClick={handleStop}
              className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white shrink-0 transition-colors"
              title="Hentikan Proses (Stop)"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !isConnected}
              className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white shrink-0 transition-colors"
              title="Kirim Pesan (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-emerald-400" />
            Simular Box Cloud (38 Tools) Aktif
          </span>
          <span>Tekan <strong>Enter</strong> untuk kirim, <strong>Shift+Enter</strong> baris baru</span>
        </div>
      </div>
    </div>
  );
};
