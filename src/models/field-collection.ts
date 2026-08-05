// ETAPA 11 — Coleta campo por campo.
//
// Este módulo cuida APENAS da apresentação e do preparo do valor digitado pelo
// usuário (formato de entrada). Nenhuma validação fiscal acontece aqui: todo
// valor é enviado para a Okton validar e é o valor normalizado dela que vale.

export type CollectFieldOption = { value: string; label: string };

export type CollectField = {
  key: string;
  label: string;
  description?: string | null;
  type: string;
  required?: boolean;
  options?: CollectFieldOption[];
};

/** Tipos de campo suportados pelo middleware (ETAPA 11). */
export const SUPPORTED_FIELD_TYPES = [
  "text",
  "number",
  "currency",
  "date",
  "datetime",
  "cpf",
  "cnpj",
  "cpf_cnpj",
  "select",
  "multiselect",
  "boolean",
  "product_search",
  "customer_search",
  "vehicle_search",
  "driver_search",
  "invoice_key",
  "invoice_key_list",
  "item_list",
  "address",
  "file",
] as const;

export type CollectFieldType = (typeof SUPPORTED_FIELD_TYPES)[number] | string;

/** Dica de preenchimento por tipo — nunca uma regra fiscal, apenas formato. */
const TYPE_HINT: Record<string, string> = {
  number: "Informe apenas números.",
  currency: "Informe o valor em reais (ex.: 1234,56).",
  date: "Informe a data no formato DD/MM/AAAA.",
  datetime: "Informe a data e a hora no formato DD/MM/AAAA HH:MM.",
  cpf: "Informe o CPF (somente números).",
  cnpj: "Informe o CNPJ (somente números).",
  cpf_cnpj: "Informe o CPF ou CNPJ (somente números).",
  multiselect: "Você pode escolher mais de uma opção, separando por vírgula.",
  boolean: "Responda 1 - Sim ou 2 - Não.",
  product_search: "Informe o código, o nome ou parte da descrição do produto.",
  customer_search: "Informe o nome, o CPF/CNPJ ou o código do cliente.",
  vehicle_search: "Informe a placa ou o código do veículo.",
  driver_search: "Informe o nome ou o CPF do motorista.",
  invoice_key: "Informe a chave de acesso com 44 dígitos.",
  invoice_key_list: "Informe uma ou mais chaves de acesso, separadas por vírgula ou uma por linha.",
  item_list: "Informe um item por linha.",
  address: "Informe o endereço completo (rua, número, bairro, cidade e UF).",
  file: "Envie o arquivo ou informe o link do documento.",
};

/** Tipos que resolvem um cadastro na Okton e pedem confirmação do usuário. */
const CONFIRMABLE_TYPES = new Set([
  "cpf",
  "cnpj",
  "cpf_cnpj",
  "product_search",
  "customer_search",
  "vehicle_search",
  "driver_search",
  "invoice_key",
]);

export function shouldConfirmField(field: CollectField, hasResolvedData: boolean) {
  return hasResolvedData || CONFIRMABLE_TYPES.has(field.type);
}

/** Monta a pergunta: label + descrição + opções + dica de formato. */
export function buildFieldPrompt(field: CollectField): string {
  const parts: string[] = [];
  parts.push(field.label?.trim() || field.key);
  if (field.description?.trim()) parts.push(field.description.trim());

  const options = field.options ?? [];
  if (field.type === "boolean" && options.length === 0) {
    parts.push("1 - Sim\n2 - Não");
  } else if (options.length > 0) {
    parts.push(options.map((option, index) => `${index + 1} - ${option.label}`).join("\n"));
  }

  const hint = TYPE_HINT[field.type];
  if (hint && !(field.type === "boolean" && options.length === 0)) parts.push(hint);
  if (field.required === false) parts.push("Campo opcional: responda *PULAR* para seguir.");

  return parts.filter(Boolean).join("\n\n");
}

function toDecimal(raw: string): number {
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  return Number(normalized);
}

function digits(raw: string) {
  return raw.replace(/[^0-9]/g, "");
}

function splitList(raw: string): string[] {
  return raw
    .split(/[\n;,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickOption(options: CollectFieldOption[], raw: string): CollectFieldOption | null {
  const text = raw.trim();
  const index = Number(text);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1];
  const lower = text.toLowerCase();
  return (
    options.find(
      (option) => option.value.toLowerCase() === lower || option.label.toLowerCase() === lower,
    ) ?? null
  );
}

export type PreparedValue = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Prepara o valor digitado para envio à Okton. Só verifica formato de entrada
 * (nunca regra fiscal) para evitar chamadas obviamente inválidas.
 */
export function prepareFieldValue(field: CollectField, raw: string): PreparedValue {
  const text = raw.trim();
  const options = field.options ?? [];

  if (!text && field.required !== false) {
    return { ok: false, message: "Este campo é obrigatório." };
  }

  switch (field.type) {
    case "number":
    case "currency": {
      const value = toDecimal(text);
      if (Number.isNaN(value)) return { ok: false, message: "Informe um número válido." };
      return { ok: true, value };
    }

    case "boolean": {
      if (options.length > 0) {
        const chosen = pickOption(options, text);
        if (!chosen) return { ok: false, message: "Opção inválida." };
        return { ok: true, value: chosen.value };
      }
      if (/^(1|sim|s|true|verdadeiro)$/i.test(text)) return { ok: true, value: true };
      if (/^(2|nao|não|n|false|falso)$/i.test(text)) return { ok: true, value: false };
      return { ok: false, message: "Responda 1 - Sim ou 2 - Não." };
    }

    case "select": {
      if (options.length === 0) return { ok: true, value: text };
      const chosen = pickOption(options, text);
      if (!chosen) return { ok: false, message: "Opção inválida." };
      return { ok: true, value: chosen.value };
    }

    case "multiselect": {
      const entries = splitList(text);
      if (entries.length === 0) return { ok: false, message: "Informe ao menos uma opção." };
      if (options.length === 0) return { ok: true, value: entries };
      const chosen: string[] = [];
      for (const entry of entries) {
        const option = pickOption(options, entry);
        if (!option) return { ok: false, message: `Opção inválida: ${entry}.` };
        if (!chosen.includes(option.value)) chosen.push(option.value);
      }
      return { ok: true, value: chosen };
    }

    case "cpf":
    case "cnpj":
    case "cpf_cnpj": {
      const only = digits(text);
      if (only.length === 0)
        return { ok: false, message: "Informe apenas os números do documento." };
      return { ok: true, value: only };
    }

    case "invoice_key": {
      const only = digits(text);
      if (only.length !== 44) {
        return { ok: false, message: "A chave de acesso deve conter 44 dígitos." };
      }
      return { ok: true, value: only };
    }

    case "invoice_key_list": {
      const keys = splitList(text).map(digits).filter(Boolean);
      if (keys.length === 0) return { ok: false, message: "Informe ao menos uma chave de acesso." };
      const invalid = keys.find((key) => key.length !== 44);
      if (invalid)
        return { ok: false, message: `Chave inválida: ${invalid} (precisa ter 44 dígitos).` };
      return { ok: true, value: keys };
    }

    case "item_list": {
      const items = text
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (items.length === 0) return { ok: false, message: "Informe ao menos um item." };
      return { ok: true, value: items };
    }

    // date, datetime, address, file e *_search seguem como texto:
    // a normalização definitiva é sempre feita pela Okton.
    default:
      return { ok: true, value: text };
  }
}

/** Texto amigável do valor confirmado, usado no eco para o usuário. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.map((item) => describeValue(item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${describeValue(item)}`)
      .join("\n");
  }
  return String(value);
}

/** Bloco "Encontrei: ..." montado só com o que a Okton devolveu. */
export function resolvedSummary(
  resolved: Record<string, unknown> | null | undefined,
  displayValue: string | null | undefined,
): string {
  const lines: string[] = [];
  if (displayValue) lines.push(displayValue);
  for (const [key, value] of Object.entries(resolved ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${key}: ${describeValue(value)}`);
  }
  return lines.join("\n");
}
