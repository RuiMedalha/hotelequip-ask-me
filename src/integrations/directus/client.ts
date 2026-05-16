import type { DirectusListResponse, DirectusSingleItemResponse } from "@/types/directus";

const rawBase = (import.meta.env.VITE_DIRECTUS_URL as string | undefined)?.trim();
const token = (import.meta.env.VITE_DIRECTUS_TOKEN as string | undefined)?.trim();

export const directusBaseUrl = rawBase?.replace(/\/+$/, "") ?? "";

export const isDirectusConfigured = Boolean(directusBaseUrl);

/** Nomes das collections no Directus (alterar aqui se o Hub usar outros slugs). */
export const DIRECTUS_COLLECTIONS = {
  conversations:
    ((import.meta.env.VITE_DIRECTUS_CONVERSATIONS_COLLECTION as string | undefined)?.trim())
    || "conversations",
  messages:
    ((import.meta.env.VITE_DIRECTUS_MESSAGES_COLLECTION as string | undefined)?.trim())
    || "messages",
} as const;

export class DirectusRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "DirectusRequestError";
  }
}

function normalizePath(path: string): string {
  if (path.startsWith("http")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Pedido REST ao Directus (Content API).
 * - `path` relativamente ao domínio (ex.: `/items/conversations`).
 * - Bearer só é enviado se `VITE_DIRECTUS_TOKEN` estiver definido.
 */
export async function directusRequest<T = unknown>(
  path: string,
  options: RequestInit & { skipJsonParse?: boolean } = {},
): Promise<T> {
  if (!directusBaseUrl) {
    throw new Error("VITE_DIRECTUS_URL não está definido.");
  }

  const { skipJsonParse, ...fetchInit } = options;
  const url = `${directusBaseUrl}${normalizePath(path)}`;
  const headers = new Headers(fetchInit.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const hasBody =
    fetchInit.body !== undefined
    && fetchInit.body !== null
    && !(typeof fetchInit.body === "string" && fetchInit.body === "");

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...fetchInit, headers });
  const text = await res.text();

  let parsed: unknown = text;
  if (text && !skipJsonParse) {
    try {
      parsed = JSON.parse(text);
    }
    catch {
      parsed = text;
    }
  }
  else if (!text) {
    parsed = undefined;
  }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed !== null && "errors" in parsed
        ? `Directus error (${res.status})`
        : `Directus request failed (${res.status})`;
    throw new DirectusRequestError(msg, res.status, parsed);
  }

  return parsed as T;
}

export async function readDirectusItem<T>(path: string): Promise<T | null> {
  const res = await directusRequest<DirectusSingleItemResponse<T>>(path);
  return res?.data ?? null;
}

export async function readDirectusList<T>(path: string): Promise<T[]> {
  const res = await directusRequest<DirectusListResponse<T>>(path);
  return Array.isArray(res?.data) ? res.data : [];
}
