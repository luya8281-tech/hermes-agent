import React, { useState, useEffect } from "react";
import { Check, XCircle, ChevronDown, ChevronUp, Copy, CheckCheck } from "lucide-react";

export interface ActionInfo {
  id: string;
  type: string;
  label: string;
  status: "running" | "done";
  subject?: string;
  startedAt?: number;
  durationMs?: number;
  output?: string;
  details?: string;
  isError?: boolean;
}

export const StatusGlyph: React.FC<{ action: ActionInfo }> = ({ action }) => {
  if (action.status === "running") {
    return (
      <div className="w-3.5 h-3.5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin shrink-0" />
    );
  }
  if (action.isError) {
    return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  }
  return <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
};

export const LiveActionCard: React.FC<{ action: ActionInfo }> = ({ action }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRunning = action.status === "running";
  const startedAt = action.startedAt;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning || !startedAt) return;
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [isRunning, startedAt]);

  const durationText = isRunning && startedAt
    ? (elapsed / 1000).toFixed(1) + "s"
    : action.durationMs !== undefined
    ? (action.durationMs / 1000).toFixed(1) + "s"
    : "";

  const fullText = action.output || action.details || "";

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getBadgeStyle = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes("bash") || t === "terminal") {
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    }
    if (t.includes("simular") || t.includes("box")) {
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    }
    if (t.includes("search") || t.includes("web")) {
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    }
    if (t.includes("file") || t.includes("workspace")) {
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    }
    return "bg-slate-500/15 text-slate-300 border-slate-500/30";
  };

  return (
    <div
      className={`rounded-lg border transition-all overflow-hidden ${
        isRunning
          ? "bg-slate-900/90 border-emerald-500/40 shadow-sm shadow-emerald-500/10"
          : action.isError
          ? "bg-slate-900/70 border-red-500/40"
          : "bg-slate-900/70 border-slate-800 hover:border-slate-700"
      }`}
    >
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none gap-3"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <StatusGlyph action={action} />
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${getBadgeStyle(
              action.type
            )}`}
          >
            {action.type}
          </span>
          <span
            className="font-mono text-xs text-slate-200 truncate flex-1"
            title={action.subject}
          >
            {action.subject || action.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {durationText && (
            <span className="font-mono text-[11px] text-slate-400">
              {durationText}
            </span>
          )}
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          )}
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-slate-800 bg-black/60 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[11px] uppercase font-semibold text-slate-400 tracking-wider">
              Output Eksekusi Tool
            </span>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition-colors"
            >
              {copied ? (
                <>
                  <CheckCheck className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Salin Log</span>
                </>
              )}
            </button>
          </div>
          <pre className="font-mono text-xs text-slate-200 bg-slate-950 p-2.5 rounded border border-slate-800/80 overflow-x-auto max-h-64 whitespace-pre-wrap break-all leading-relaxed">
            {fullText || "(Tidak ada output teks)"}
          </pre>
        </div>
      )}
    </div>
  );
};
