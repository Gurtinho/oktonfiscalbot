// ETAPA 20 — Mascaramento obrigatório antes de qualquer gravação em log.
// Nada aqui envolve regra fiscal: apenas ofuscação de dados sensíveis.

/** Chaves cujo valor NUNCA pode ser registrado integralmente. */
export const SECRET_KEYS = [
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "bearer",
  "client_secret",
  "clientsecret",
  "client_id",
  "api_key",
  "apikey",
  "x-api-key",
  "password",
  "senha",
  "secret",
  "webhook_secret",
  "signature",
  "assinatura",
  "certificado",
  "certificate",
  "pfx",
  "private_key",
  "card",
  "cartao",
  "card_number",
  "numero_cartao",
  "cvv",
  "cvc",
  "pan",
];

/** Chaves cujo valor é documento (CPF/CNPJ) e deve ser parcialmente ofuscado. */
const DOCUMENT_KEYS = [
  "cpf",
  "cnpj",
  "documento",
  "document",
  "cpf_cnpj",
  "doc",
  "taxid",
  "tax_id",
];

/** Chaves de telefone. */
const PHONE_KEYS = [
  "phone",
  "telefone",
  "celular",
  "whatsapp",
  "phone_number",
  "msisdn",
  "from",
  "to",
];

/** 123.456.789-01 -> ***.***.789-01 · 12.345.678/0001-99 -> **.***.678/0001-** */
export function maskCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `***.***.${digits.slice(6, 9)}-${digits.slice(9)}`;
  if (digits.length === 14) return `**.***.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
  return value;
}

/** 5511987654321 -> +55 11 *****-4321 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "***";
  const tail = digits.slice(-4);
  const ddd = digits.length >= 11 ? digits.slice(-11, -9) : "";
  const country = digits.length >= 12 ? `+${digits.slice(0, digits.length - 11)} ` : "";
  return `${country}${ddd ? `${ddd} ` : ""}*****-${tail}`;
}

/** Ofusca CPF/CNPJ e telefones encontrados dentro de um texto livre. */
export function maskTextPii(text: string): string {
  return text
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, (m) => maskCpfCnpj(m))
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, (m) => maskCpfCnpj(m))
    .replace(/\b\d{4}[ .-]?\d{4}[ .-]?\d{4}[ .-]?\d{4}\b/g, "**** **** **** ****")
    .replace(/\+?\d{2}?\s?\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4}\b/g, (m) => maskPhone(m));
}

function isKey(key: string, list: string[]) {
  const k = key.toLowerCase();
  return list.some((candidate) => k === candidate || k.endsWith(`_${candidate}`));
}

/**
 * Sanitiza qualquer estrutura antes do log:
 * segredos viram "***", documentos e telefones ficam parcialmente ofuscados.
 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[...]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value))
    return value.slice(0, 25).map((item) => sanitizeForLog(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isKey(key, SECRET_KEYS)) {
        out[key] = "***";
      } else if (typeof item === "string" && isKey(key, DOCUMENT_KEYS)) {
        out[key] = maskCpfCnpj(item);
      } else if (typeof item === "string" && isKey(key, PHONE_KEYS)) {
        out[key] = maskPhone(item);
      } else {
        out[key] = sanitizeForLog(item, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    const masked = maskTextPii(value);
    return masked.length > 800 ? `${masked.slice(0, 800)}…` : masked;
  }
  return value;
}
