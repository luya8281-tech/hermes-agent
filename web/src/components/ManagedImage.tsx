import React, { useEffect, useState } from "react";

import { api } from "@/lib/api";

/** Sources that render directly without a managed-file fetch. */
function isDirectSrc(src: string): boolean {
  return /^(https?:|data:image\/|blob:)/i.test(src);
}

/**
 * A photo attached to the conversation, rendered inline in the chat.
 * Remote URLs, image data URLs and blob URLs render directly; absolute
 * server paths resolve through /api/files/read (authed, returns a data
 * URL). Anything else — relative paths, unknown schemes — never becomes
 * an <img> src. A path that cannot be read renders nothing when
 * speculative (auto-detected), or a quiet fallback line when the author
 * explicitly embedded it in markdown.
 */
export const ManagedImage: React.FC<{
  src: string;
  alt?: string;
  explicit?: boolean;
}> = ({ src, alt = "", explicit = false }) => {
  const trimmed = (src || "").trim();
  const direct = isDirectSrc(trimmed);
  const [resolved, setResolved] = useState<string | null>(
    direct ? trimmed : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (direct || !trimmed) return;
    if (!trimmed.startsWith("/")) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    api
      .readFile(trimmed)
      .then((res) => {
        if (cancelled) return;
        if (res.mime_type?.startsWith("image/") && res.data_url) {
          setResolved(res.data_url);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, direct]);

  if (!trimmed) return null;
  if (failed) {
    if (!explicit) return null;
    return (
      <span className="block py-1 font-sans text-[11px] text-[var(--vc-muted-fg)]">
        {alt || trimmed.split("/").pop() || "Gambar"} · tidak dapat dimuat
      </span>
    );
  }
  if (!resolved) return null;
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      className="my-1 block h-auto max-h-[420px] w-auto max-w-full rounded-lg object-contain"
    />
  );
};
