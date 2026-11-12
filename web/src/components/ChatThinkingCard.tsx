import React, { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";

import { VeeSpinner } from "./LiveActionCard";

interface ChatThinkingCardProps {
  reasoning: string;
  isLive?: boolean;
}

/** One-line THINKING row with the reasoning in an expandable panel. */
export const ChatThinkingCard: React.FC<ChatThinkingCardProps> = ({
  reasoning,
  isLive = false,
}) => {
  const [open, setOpen] = useState(isLive);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const text = (reasoning || "").trim();

  useEffect(() => {
    if (!isLive || !open || !panelRef.current) return;
    panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }, [isLive, open, reasoning]);

  if (!text) return null;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const liveTail = isLive ? text.replace(/\s+/g, " ").slice(-90) : "";

  return (
    <div className="my-0.5 w-fit max-w-full font-sans">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.035]"
      >
        {isLive ? (
          <VeeSpinner size={13} className="text-[var(--vc-muted-fg)]" />
        ) : (
          <Brain className="w-3.5 h-3.5 shrink-0 text-[var(--vc-muted-fg)]" />
        )}

        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-[var(--vc-muted-fg)]/80">
          THINKING
        </span>

        <span
          className={`min-w-0 max-w-[22rem] flex-1 truncate text-[11px] ${
            isLive
              ? "vc-text-shimmer text-[var(--vc-muted-fg)]"
              : "text-[var(--vc-muted-fg)]"
          }`}
        >
          {isLive ? liveTail || "Sedang berpikir..." : "Proses pemikiran"}
        </span>

        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--vc-muted-fg)]/70">
          {wordCount} kata
        </span>

        {open ? (
          <ChevronUp className="w-3.5 h-3.5 shrink-0 text-[var(--vc-muted-fg)]" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[var(--vc-muted-fg)]" />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="max-h-48 w-[min(88vw,28rem)] select-text overflow-y-auto whitespace-pre-wrap break-words border-t border-[var(--vc-border)]/60 bg-[#151514]/70 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-[var(--vc-muted-fg)]"
        >
          {text}
        </div>
      )}
    </div>
  );
};
