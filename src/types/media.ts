/** Alinhado com HubChat MessageContent / attachments. */
export type MediaContentType = "text" | "image" | "audio" | "video" | "file";

export interface MessageAttachment {
  type: MediaContentType;
  filename: string;
  mime_type: string;
  size_bytes: number;
  base64?: string | null;
  url?: string | null;
}

export interface OutboundMediaPayload {
  text?: string;
  content_type: MediaContentType;
  attachments: MessageAttachment[];
}

export interface PendingMediaFile {
  id: string;
  file: File;
  previewUrl?: string;
  contentType: MediaContentType;
}
