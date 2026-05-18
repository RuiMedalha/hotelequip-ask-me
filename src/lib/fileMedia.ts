import type { MediaContentType, MessageAttachment } from "@/types/media";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/m4a"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const LIMITS: Record<MediaContentType, number> = {
  text: 0,
  image: 8 * 1024 * 1024,
  audio: 15 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  file: 20 * 1024 * 1024,
};

export function detectMediaType(file: File): MediaContentType {
  const mime = (file.type || "").toLowerCase();
  if (IMAGE_TYPES.has(mime) || mime.startsWith("image/")) return "image";
  if (AUDIO_TYPES.has(mime) || mime.startsWith("audio/")) return "audio";
  if (VIDEO_TYPES.has(mime) || mime.startsWith("video/")) return "video";
  if (FILE_TYPES.has(mime)) return "file";
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && ["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (ext && ["webm", "ogg", "mp3", "m4a", "mp4", "wav"].includes(ext)) {
    return ext === "mp4" ? "video" : "audio";
  }
  if (ext && ["pdf", "doc", "docx", "xls", "xlsx"].includes(ext)) return "file";
  return "file";
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Falha ao ler ficheiro."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler ficheiro."));
    reader.readAsDataURL(file);
  });
}

export function validateFile(file: File): { ok: true } | { ok: false; error: string } {
  const type = detectMediaType(file);
  const limit = LIMITS[type];
  if (limit > 0 && file.size > limit) {
    return {
      ok: false,
      error: `Ficheiro demasiado grande (máx. ${formatFileSize(limit)} para ${type}).`,
    };
  }
  const mime = (file.type || "").toLowerCase();
  const allowed =
    IMAGE_TYPES.has(mime)
    || AUDIO_TYPES.has(mime)
    || VIDEO_TYPES.has(mime)
    || FILE_TYPES.has(mime)
    || mime.startsWith("image/")
    || mime.startsWith("audio/")
    || mime.startsWith("video/")
    || !mime;

  if (!allowed && type === "file") {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const extOk = ext && ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "webp", "webm", "ogg", "mp3", "mp4", "m4a"].includes(ext);
    if (!extOk) {
      return { ok: false, error: "Tipo de ficheiro não suportado." };
    }
  }
  return { ok: true };
}

export async function fileToMessageAttachment(file: File): Promise<MessageAttachment> {
  const validation = validateFile(file);
  if (!validation.ok) {
    throw new Error(validation.ok === false ? validation.error : "Ficheiro inválido.");
  }
  const type = detectMediaType(file);
  const base64 = await fileToBase64(file);
  return {
    type,
    filename: file.name || `${type}-${Date.now()}`,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    base64,
    url: null,
  };
}

export function attachmentToObjectUrl(att: MessageAttachment): string | null {
  if (att.url) return att.url;
  if (!att.base64) return null;
  const mime = att.mime_type || "application/octet-stream";
  return `data:${mime};base64,${att.base64}`;
}

export function lastMessageLabelForMedia(
  contentType: MediaContentType,
  text?: string,
): string {
  if (text?.trim()) return text.trim();
  switch (contentType) {
    case "image": return "[imagem]";
    case "audio": return "[áudio]";
    case "video": return "[vídeo]";
    case "file": return "[ficheiro]";
    default: return "";
  }
}

export function pickVoiceRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/ogg")) return "audio/ogg";
  return "audio/webm";
}
