import type { MediaContentType, MessageAttachment } from "@/types/media";

export function parseDirectusAttachments(raw: unknown): MessageAttachment[] {
  if (!raw) return [];
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    }
    catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      type: normalizeContentType(item.type),
      filename: String(item.filename ?? item.name ?? "ficheiro"),
      mime_type: String(item.mime_type ?? item.mimeType ?? "application/octet-stream"),
      size_bytes: Number(item.size_bytes ?? item.sizeBytes ?? 0) || 0,
      base64: typeof item.base64 === "string" ? item.base64 : null,
      url: typeof item.url === "string" ? item.url : null,
    }));
}

export function normalizeContentType(raw: unknown): MediaContentType {
  const t = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (t === "image" || t === "audio" || t === "video" || t === "file") return t;
  return "text";
}

export function readDirectusMessageContentType(row: Record<string, unknown>): MediaContentType {
  return normalizeContentType(row.content_type ?? row.contentType);
}

export function directusRowToAttachments(row: Record<string, unknown>): MessageAttachment[] {
  const parsed = parseDirectusAttachments(row.attachments);
  if (parsed.length > 0) return parsed;
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (!content) return [];
  return [];
}
