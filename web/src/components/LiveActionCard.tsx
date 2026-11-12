import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, XCircle } from "lucide-react";

import { copyTextToClipboard } from "@/lib/clipboard";
import {
  formatDuration,
  getActionBadge,
  tailOutput,
} from "@/lib/chat-display";

export interface ActionInfo {
  id: string;
  /** Human badge shown before the subject (BASH, SEARCH, BROWSER, …). */
  type: string;
  /** Raw tool name. */
  label: string;
  status: "running" | "done";
  subject?: string;
  startedAt?: number;
  durationMs?: number;
  output?: string;
  details?: string;
  isError?: boolean;
  url?: string;
}

/** Eight-petal abstract spinner — the ai-chat "working" glyph. */
export const VeeSpinner: React.FC<{ size?: number; className?: string }> = ({
  size = 13,
  className = "",
}) => {
  const petals = [
    { angle: 0, height: 9, delay: 0 },
    { angle: 45, height: 7, delay: -0.6 },
    { angle: 90, height: 10, delay: -1.2 },
    { angle: 135, height: 6.5, delay: -0.3 },
    { angle: 180, height: 9.5, delay: -0.9 },
    { angle: 225, height: 7.5, delay: -1.5 },
    { angle: 270, height: 10, delay: -0.15 },
    { angle: 315, height: 6.5, delay: -1.05 },
  ];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`vc-spinner shrink-0 ${className}`}
      aria-hidden="true"
    >
      {petals.map((petal) => (
        <g key={petal.angle} transform={`rotate(${petal.angle} 12 12)`}>
          <rect
            className="vc-spinner-petal"
            x="11"
            y={12 - petal.height}
            width="2"
            height={petal.height}
            rx="1"
            fill="currentColor"
            style={{ animationDelay: `${petal.delay}s` }}
          />
        </g>
      ))}
    </svg>
  );
};

/**
 * Turn-end settle: actions still marked running when their turn finishes
 * (missed completion event, crash, interrupt) must render as finished —
 * otherwise their spinner/shimmer runs again on every later render.
 */
export function settleActions(actions: ActionInfo[]): ActionInfo[] {
  let changed = false;
  const next = actions.map((action) => {
    if (action.status !== "running") return action;
    changed = true;
    return {
      ...action,
      status: "done" as const,
      durationMs:
        action.durationMs ??
        (action.startedAt ? Date.now() - action.startedAt : undefined),
    };
  });
  return changed ? next : actions;
}

export const StatusGlyph: React.FC<{ action: ActionInfo }> = ({ action }) => {
  if (action.status === "running") {
    return <VeeSpinner size={13} className="text-[var(--vc-primary)]" />;
  }
  if (action.isError) {
    return <XCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />;
  }
  return <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />;
};

/**
 * Compact action row: status · badge · subject · live duration, with the log in
 * a dropdown. Matches the ai-chat live-action card (no noisy inline output).
 */
export const LiveActionCard: React.FC<{ action: ActionInfo }> = ({ action }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isRunning = action.status === "running";
  const startedAt = action.startedAt;
  const [elapsed, setElapsed] = useState(() =>
    action.startedAt ? Date.now() - action.startedAt : 0,
  );

  useEffect(() => {
    if (!isRunning || !startedAt) return;
    const timer = window.setInterval(
      () => setElapsed(Date.now() - startedAt),
      250,
    );
    return () => window.clearInterval(timer);
  }, [isRunning, startedAt]);

  const duration = formatDuration(isRunning && startedAt ? elapsed : action.durationMs);
  const fullText = action.output || action.details || "";
  const subject = action.subject || action.label;
  const badge = getActionBadge(action.type, action.label);
  const tail = useMemo(
    () => (isOpen ? tailOutput(fullText, 8, 900) : ""),
    [isOpen, fullText],
  );
  const lineCount = useMemo(
    () => (fullText ? fullText.split("\n").length : 0),
    [fullText],
  );

  const handleCopy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const ok = await copyTextToClipboard(fullText);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-0.5 w-full font-sans">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.035]"
      >
        <StatusGlyph action={action} />
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-[var(--vc-muted-fg)]/80">
          {badge}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
            isRunning
              ? "vc-text-shimmer"
              : action.isError
                ? "text-red-500/90"
                : "text-[var(--vc-fg)]/85"
          }`}
          title={subject}
        >
          {subject}
        </span>
        {duration && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--vc-muted-fg)]">
            {duration}
          </span>
        )}
        {isOpen ? (
          <ChevronUp className="w-3.5 h-3.5 shrink-0 text-[var(--vc-muted-fg)]" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--vc-muted-fg)]" />
        )}
      </button>

      {isOpen && (
        <div className="space-y-2 pb-2 pl-7 pr-1.5 pt-1">
          {action.label && action.label !== subject && (
            <div className="font-mono text-[10.5px] text-[var(--vc-muted-fg)]">
              {action.label}
            </div>
          )}

          {tail && (
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-[var(--vc-border)] py-0.5 pl-3 font-mono text-[10.5px] leading-snug text-[var(--vc-muted-fg)]">
              {tail}
            </pre>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {action.url && (
              <a
                href={action.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1 px-1 py-0.5 text-[10px] font-medium text-[var(--vc-muted-fg)] transition-colors hover:text-[var(--vc-fg)]"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Buka</span>
              </a>
            )}

            {fullText && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setLogOpen((value) => !value);
                }}
                className="inline-flex items-center gap-1 px-1 py-0.5 text-[10px] font-medium text-[var(--vc-muted-fg)] transition-colors hover:text-[var(--vc-fg)]"
              >
                {logOpen ? "Tutup log" : "Log penuh"}
                <span className="text-[9px] opacity-70">{lineCount}</span>
              </button>
            )}

            {fullText && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 px-1 py-0.5 text-[10px] font-medium text-[var(--vc-muted-fg)] transition-colors hover:text-[var(--vc-fg)]"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-[var(--vc-primary)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copied ? "Tersalin" : "Salin"}</span>
              </button>
            )}
          </div>

          {logOpen && fullText && (
            <div className="overflow-hidden border-l-2 border-[var(--vc-border)] pl-3">
              <div className="flex items-center justify-between py-1 font-mono text-[10px] text-[var(--vc-muted-fg)]">
                <span>{lineCount} baris</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 hover:text-[var(--vc-fg)]"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-[var(--vc-primary)]" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copied ? "Tersalin" : "Salin"}</span>
                </button>
              </div>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words py-1 font-mono text-[10.5px] leading-relaxed text-[var(--vc-muted-fg)]">
                {fullText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
