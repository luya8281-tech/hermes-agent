import React, { useMemo, useState } from "react";
import { Check, ChevronRight, XCircle } from "lucide-react";

import { ChatThinkingCard } from "./ChatThinkingCard";
import {
  LiveActionCard,
  settleActions,
  type ActionInfo,
} from "./LiveActionCard";
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
  // A collapsed summary is by definition a finished turn: settle any stale
  // running status so nothing inside it can animate again.
  const settledActions = useMemo(() => settleActions(actions), [actions]);
  const total = useMemo(
    () =>
      settledActions.reduce((sum, action) => sum + (action.durationMs || 0), 0),
    [settledActions],
  );
  const hasError = settledActions.some((action) => action.isError);

  if (actions.length === 0 && !reasoning) return null;

  const operationCount = Math.max(1, settledActions.length);

  return (
    <div className="my-1 w-full font-sans">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--vc-muted-fg)] transition-colors hover:text-[var(--vc-fg)]"
      >
        {hasError ? (
          <XCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
        ) : (
          <Check className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="font-medium">
          {operationCount} operasi
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
        <div className="mt-0.5 space-y-0.5 pl-1">
          {reasoning && <ChatThinkingCard reasoning={reasoning} />}
          {settledActions.map((action) => (
            <LiveActionCard key={action.id} action={action} />
          ))}
        </div>
      )}
    </div>
  );
};
