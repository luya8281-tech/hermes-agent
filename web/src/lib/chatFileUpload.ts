import { api } from "@/lib/api";

// Documents ride the managed-files upload stream: the installed backend has
// no /api/chat/file-upload route (that arrived in a newer Hermes), but
// /api/files/upload-stream stages any file at an absolute path. Stage under
// the same Hermes home the image endpoint uses, with a unique dashboard-
// name, so the agent can open the file by absolute path.
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const UPLOADS_DIR = "/root/.hermes/uploads";

export interface ChatFileUploadResult {
  /** Absolute staged path the agent can open. */
  path: string;
  /** Byte size of the uploaded file. */
  size: number;
  /** Original file name as picked. */
  name: string;
}

function sanitizeFileName(name: string): string {
  const base = (name || "file").split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 100);
}

export async function uploadChatFile(
  file: File,
): Promise<ChatFileUploadResult> {
  if (file.size === 0) throw new Error("File kosong");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File terlalu besar (maks 16 MB)");
  }
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const target = `${UPLOADS_DIR}/dashboard_${stamp}_${sanitizeFileName(file.name)}`;
  const res = await api.uploadFile(target, file, true);
  const path = res?.path || target;
  if (!path) throw new Error("Upload file tidak mengembalikan path");
  return { path, size: file.size, name: file.name };
}
