import React, { useMemo, useState } from "react";
import { Check, ChevronRight, XCircle } from "lucide-react";

import { ChatThinkingCard } from "./ChatThinkingCard";
import { LiveActionCard, type ActionInfo } from "./LiveActionCard";
import { formatDuration } from "@/lib/chat-display";

interface ChatOperationSummaryProps {
  actions: ActionInfo[];
  reasoning?: string;
}

/** Collapsed trace for a finished turn: one row, expandable to the action log. */
export const ChatOperationSummary: React.FC<ChatOperationSummaryProps> = ({
  actions,
  reasoning,
}) => {
  const [open, setOpen] = useState(false);
  const total = useMemo(
    () => actions.reduce((sum, action) => sum + (action.durationMs || 0), 0),
    [actions],
  );
  const hasError = actions.some((action) => action.isError);

  if (actions.length === 0 && !reasoning) return null;

  return (
    <div className="my-1.5 w-full font-sans">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--vc-border)] bg-[var(--vc-card)]/70 px-2.5 py-1.5 text-[11px] transition-colors hover:border-[rgb(204_120_92_/_0.5)]"
      >
        {hasError ? (
          <XCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
        ) : (
          <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="font-medium text-[var(--vc-fg)]">
          {actions.length} operasi
        </span>
        {total > 0 && (
          <span className="font-mono text-[10px] tabular-nums text-[var(--vc-muted-fg)]">
            {formatDuration(total)}
          </span>
        )}
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 text-[var(--vc-muted-fg)] transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>

      {open && (
        <div className="mt-1 space-y-1 rounded-lg border border-[var(--vc-border)]/70 bg-[#151514]/40 p-1.5">
          {reasoning && <ChatThinkingCard reasoning={reasoning} />}
          {actions.map((action) => (
            <LiveActionCard key={action.id} action={action} />
          ))}
        </div>
      )}
    </div>
  );
};
