/** Frases que nunca devem ser tratadas como nome de pessoa. */
const NOT_A_NAME_PHRASES = new Set([
  "quero comprar",
  "preciso de preco",
  "preciso de preço",
  "preciso de orcamento",
  "preciso de orçamento",
  "tenho interesse",
  "comprar",
  "lavar",
  "frytop",
  "cafe",
  "café",
  "humano",
  "operador",
  "preco",
  "preço",
  "orcamento",
  "orçamento",
  "equipa",
  "atendimento",
  "posso ajudar",
  "posso ajudar?",
]);

const NOT_A_NAME_WORDS = new Set([
  "comprar",
  "preco",
  "preço",
  "orcamento",
  "orçamento",
  "interesse",
  "humano",
  "operador",
  "equipa",
  "atendimento",
  "lavar",
  "frytop",
  "cafe",
  "café",
  "produto",
  "produtos",
  "loja",
  "entrega",
  "whatsapp",
]);

function foldAccents(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Pedido explícito de agente humano (conservador).
 * Frases comerciais como "quero comprar" não activam handoff.
 */
export function isExplicitHumanRequest(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const t = foldAccents(raw.toLowerCase());

  const commercialOnly = [
    /\bquero\s+comprar\b/,
    /\btenho\s+interesse\b/,
    /\b(preco|orcamento)\b/,
    /\bposso\s+ajudar\??\s*$/,
    /^comprar$/,
    /\b(quero|preciso)\s+(de\s+)?(um\s+)?(preco|orcamento)\b/,
    /\blavar\b/,
    /\bfrytop\b/,
    /\bcafe\b/,
  ];
  if (commercialOnly.some((re) => re.test(t))) return false;

  const explicit = [
    /^humano$/,
    /\bhumano\b/,
    /\bfalar\s+com\s+(um\s+)?(humano|agente|operador|pessoa|alguem)\b/,
    /\bfalar\s+com\s+alguem(\s+da\s+equipa)?\b/,
    /^operador$/,
    /\boperador\b/,
    /\bassistente\s+humano\b/,
    /^equipa$/,
    /\b(falar\s+com\s+(a\s+)?equipa|quero\s+(a\s+)?equipa)\b/,
    /^atendimento$/,
    /\batendimento\s+humano\b/,
    /\bquero\s+(falar\s+com\s+)?(humano|operador|agente|atendimento)\b/,
    /\bpreciso\s+(de\s+)?(falar\s+com\s+)?(humano|operador|agente|alguem)\b/,
    /\b(pedir|chamar)\s+.{0,24}?(humano|operador|atendimento)\b/,
  ];

  return explicit.some((re) => re.test(t));
}

/** Extrai telefone PT; normaliza 9 dígitos (9xxxxxxxx) para +351XXXXXXXXX. */
export function extractPhone(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const compact = raw.replace(/[\s.-]/g, "");

  if (/^(\+351|351)?9\d{8}$/.test(compact)) {
    const nine = compact.replace(/^(\+?351)/, "");
    if (/^9\d{8}$/.test(nine)) return `+351${nine}`;
  }

  if (/^9\d{8}$/.test(compact)) return `+351${compact}`;

  const inline = raw.match(/(?:\+351|00351|351)?\s*([9]\d{2})[\s.-]?(\d{3})[\s.-]?(\d{3})/);
  if (inline) {
    const nine = `${inline[1]}${inline[2]}${inline[3]}`;
    if (/^9\d{8}$/.test(nine)) return `+351${nine}`;
  }

  const plus = raw.match(/\+351\s*([9]\d{8})/);
  if (plus && /^9\d{8}$/.test(plus[1])) return `+351${plus[1]}`;

  return null;
}

/** Nome próprio provável (ex.: "Rui", "João Silva") — não frases comerciais nem pedidos humanos. */
export function looksLikePersonName(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length < 2 || raw.length > 60) return false;
  if (extractPhone(raw)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return false;
  if (/\d/.test(raw)) return false;

  const norm = foldAccents(raw.toLowerCase());
  if (NOT_A_NAME_PHRASES.has(norm)) return false;
  if (isExplicitHumanRequest(raw)) return false;

  if (/\b(comprar|preco|orcamento|interesse|humano|equipa|atendimento|produto|entrega)\b/.test(norm)) {
    return false;
  }

  if (!/^[\p{L}\s'-]+$/u.test(raw)) return false;

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;

  if (words.length === 1) {
    const w = words[0];
    if (w.length < 2 || w.length > 30) return false;
    return !NOT_A_NAME_WORDS.has(foldAccents(w.toLowerCase()));
  }

  return words.every((w) => {
    if (w.length < 2 || w.length > 30) return false;
    return !NOT_A_NAME_WORDS.has(foldAccents(w.toLowerCase()));
  });
}
