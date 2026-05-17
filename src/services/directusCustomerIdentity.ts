import { getConversation, updateConversation } from "@/integrations/directus/conversations";
import {
  createContact,
  findContactByEmail,
  findContactByPhone,
  getContact,
  updateContact,
} from "@/integrations/directus/contacts";
import { isDirectusConfigured } from "@/integrations/directus/client";
import {
  extractEmail,
  extractPhone,
  looksLikePersonName,
} from "@/lib/chatCustomerDetails";
import type { DirectusContactPayload, DirectusConversationPayload } from "@/types/directus";

const ASK_ME_SOURCE = "ask_me";
const PLACEHOLDER_CUSTOMER_NAME = "Visitante do site";

function logDirectusDev(...args: unknown[]) {
  if (import.meta.env.DEV) console.info(...args);
}

function requireDirectusConfigured() {
  if (!isDirectusConfigured) {
    throw new Error("Directus não está configurado.");
  }
}

function coerceId(record: Record<string, unknown>, context: string): string {
  const id = record.id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  throw new Error(`${context}: resposta Directus sem id válido.`);
}

function readContactIdFromConversation(conv: Record<string, unknown> | null): string | null {
  const raw = conv?.contact_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object" && "id" in (raw as object)) {
    const nested = (raw as Record<string, unknown>).id;
    if (typeof nested === "string") return nested;
    if (typeof nested === "number") return String(nested);
  }
  return null;
}

function shouldReplaceCustomerName(current: string | null | undefined) {
  const c = (current ?? "").trim();
  return !c || c === PLACEHOLDER_CUSTOMER_NAME;
}

function contactDisplayName(contact: Record<string, unknown> | null): string | null {
  if (!contact) return null;
  for (const key of ["contact_name", "full_name", "firstname"]) {
    const v = contact[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function nameFieldsForContact(name: string): Pick<DirectusContactPayload, "contact_name" | "full_name"> {
  const trimmed = name.trim();
  return { contact_name: trimmed, full_name: trimmed };
}

function touchContactPatch(extra?: DirectusContactPayload): DirectusContactPayload {
  return {
    ...extra,
    last_seen_at: new Date().toISOString(),
    source: ASK_ME_SOURCE,
  };
}

export async function updateContactFromAskMe(id: string, patch: DirectusContactPayload) {
  requireDirectusConfigured();
  await updateContact(id, patch);
}

export async function createContactFromAskMe(
  data: DirectusContactPayload,
): Promise<string> {
  requireDirectusConfigured();
  const payload: DirectusContactPayload = {
    status: "lead",
    source: ASK_ME_SOURCE,
    last_seen_at: new Date().toISOString(),
    ...data,
  };
  const created = await createContact(payload);
  return coerceId(created.data, "createContactFromAskMe");
}

export { findContactByEmail, findContactByPhone } from "@/integrations/directus/contacts";

export async function linkConversationToContact(
  conversationId: string,
  contactId: string,
  customerNameHint?: string | null,
) {
  requireDirectusConfigured();
  const contact = await getContact(contactId);
  const fromContact = contactDisplayName(contact);
  const patch: DirectusConversationPayload = {
    contact_id: contactId,
  };
  const name = customerNameHint?.trim() || fromContact;
  if (name) patch.customer_name = name;
  await updateConversation(conversationId, patch);
  logDirectusDev("[Directus] conversation linked to contact", conversationId, contactId);
}

async function ensureContactIdForConversation(
  conversationId: string,
  conv: Record<string, unknown>,
): Promise<string | null> {
  return readContactIdFromConversation(conv);
}

async function resolveOrCreateContactByPhone(
  conversationId: string,
  conv: Record<string, unknown>,
  phone: string,
): Promise<string> {
  let contactId = readContactIdFromConversation(conv);
  const now = touchContactPatch({
    phone,
    whatsapp_number: phone,
  });

  if (contactId) {
    await updateContactFromAskMe(contactId, now);
    return contactId;
  }

  const existing = await findContactByPhone(phone);
  if (existing) {
    contactId = coerceId(existing, "resolveOrCreateContactByPhone(existing)");
    await updateContactFromAskMe(contactId, now);
    await linkConversationToContact(conversationId, contactId);
    return contactId;
  }

  const convName = typeof conv.customer_name === "string" ? conv.customer_name : "";
  const createPayload: DirectusContactPayload = { ...now };
  if (!shouldReplaceCustomerName(convName)) {
    Object.assign(createPayload, nameFieldsForContact(convName));
  }

  contactId = await createContactFromAskMe(createPayload);
  await linkConversationToContact(conversationId, contactId);
  return contactId;
}

async function resolveOrCreateContactByEmail(
  conversationId: string,
  conv: Record<string, unknown>,
  email: string,
): Promise<string> {
  let contactId = readContactIdFromConversation(conv);
  const now = touchContactPatch({ email });

  if (contactId) {
    await updateContactFromAskMe(contactId, now);
    return contactId;
  }

  const existing = await findContactByEmail(email);
  if (existing) {
    contactId = coerceId(existing, "resolveOrCreateContactByEmail(existing)");
    await updateContactFromAskMe(contactId, now);
    await linkConversationToContact(conversationId, contactId);
    return contactId;
  }

  const convName = typeof conv.customer_name === "string" ? conv.customer_name : "";
  const createPayload: DirectusContactPayload = { ...now };
  if (!shouldReplaceCustomerName(convName)) {
    Object.assign(createPayload, nameFieldsForContact(convName));
  }

  contactId = await createContactFromAskMe(createPayload);
  await linkConversationToContact(conversationId, contactId);
  return contactId;
}

async function applyPersonName(
  conversationId: string,
  conv: Record<string, unknown>,
  name: string,
  contactId: string | null,
) {
  const convPatch: DirectusConversationPayload = {};
  const currentName = typeof conv.customer_name === "string" ? conv.customer_name : "";
  if (shouldReplaceCustomerName(currentName)) {
    convPatch.customer_name = name;
  }

  if (Object.keys(convPatch).length > 0) {
    await updateConversation(conversationId, convPatch);
  }

  if (contactId) {
    await updateContactFromAskMe(contactId, {
      ...nameFieldsForContact(name),
      ...touchContactPatch(),
    });
    return;
  }

  const linkedId = readContactIdFromConversation(await getConversation(conversationId));
  if (linkedId) {
    await updateContactFromAskMe(linkedId, {
      ...nameFieldsForContact(name),
      ...touchContactPatch(),
    });
  }
}

/**
 * Captura nome, telefone e email do texto do utilizador → CRM `contacts` + `conversations`.
 * Nunca grava phone/email na conversation.
 */
export async function captureCustomerIdentity(conversationId: string, text: string) {
  requireDirectusConfigured();
  const trimmed = text.trim();
  if (!trimmed) return;

  let conv = await getConversation(conversationId);
  if (!conv) return;

  const phone = extractPhone(trimmed);
  const email = extractEmail(trimmed);
  const personName = looksLikePersonName(trimmed) ? trimmed : null;

  if (phone) {
    await resolveOrCreateContactByPhone(conversationId, conv, phone);
    conv = (await getConversation(conversationId)) ?? conv;
  }

  if (email) {
    await resolveOrCreateContactByEmail(conversationId, conv, email);
    conv = (await getConversation(conversationId)) ?? conv;
  }

  if (personName) {
    const contactId = await ensureContactIdForConversation(conversationId, conv);
    await applyPersonName(conversationId, conv, personName, contactId);
  }

  logDirectusDev("[Directus] customer identity captured", {
    conversationId,
    phone: Boolean(phone),
    email: Boolean(email),
    name: Boolean(personName),
  });
}

/**
 * Subscrição newsletter com gravação real no contacto Directus.
 * @returns true apenas após PATCH/POST bem-sucedido.
 */
export async function applyNewsletterOptIn(
  conversationId: string,
  email: string,
): Promise<boolean> {
  requireDirectusConfigured();
  const normalized = extractEmail(email);
  if (!normalized) return false;

  let conv = await getConversation(conversationId);
  if (!conv) return false;

  const consentAt = new Date().toISOString();
  const newsletterPatch: DirectusContactPayload = {
    accept_newsletter: true,
    newsletter_consent_at: consentAt,
    newsletter_consent_source: ASK_ME_SOURCE,
    newsletter_source: ASK_ME_SOURCE,
    subscribed_at: consentAt,
    email: normalized,
    ...touchContactPatch(),
  };

  let contactId = readContactIdFromConversation(conv);

  if (contactId) {
    await updateContactFromAskMe(contactId, newsletterPatch);
  }
  else {
    const existing = await findContactByEmail(normalized);
    if (existing) {
      contactId = coerceId(existing, "applyNewsletterOptIn(existing)");
      await updateContactFromAskMe(contactId, newsletterPatch);
    }
    else {
      const convName = typeof conv.customer_name === "string" ? conv.customer_name : "";
      const createPayload: DirectusContactPayload = { ...newsletterPatch };
      if (!shouldReplaceCustomerName(convName)) {
        Object.assign(createPayload, nameFieldsForContact(convName));
      }
      contactId = await createContactFromAskMe(createPayload);
    }
    await linkConversationToContact(conversationId, contactId);
  }

  logDirectusDev("[Directus] newsletter opt-in saved", contactId);
  return true;
}

/** @deprecated Use captureCustomerIdentity */
export async function syncCustomerDetailsFromUserMessage(conversationId: string, text: string) {
  await captureCustomerIdentity(conversationId, text);
}
