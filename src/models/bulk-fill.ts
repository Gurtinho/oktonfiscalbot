// ETAPA 12 — Envio de todos os campos de uma vez.
//
// Gera o modelo de preenchimento a partir do catálogo devolvido pela Okton e
// interpreta o texto respondido pelo usuário. Nada aqui decide regra fiscal:
// o texto é apenas separado em campos para que a Okton valide cada um.

import type { CollectField } from "./field-collection";

const LIST_TYPES = new Set(["item_list", "invoice_key_list", "multiselect"]);

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Token exibido no modelo (ex.: DESTINATARIO). */
export function fieldToken(field: CollectField): string {
  const base = field.label?.trim() || field.key;
  return stripAccents(base)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeToken(value: string) {
  return stripAccents(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type BulkTemplateContext = {
  documentLabel?: string | null;
  companyName?: string | null;
  branchName?: string | null;
};

/**
 * Modelo dinâmico: muda conforme documento, empresa, filial, obrigatoriedade,
 * dependências e a configuração retornada pela Okton.
 */
export function buildBulkTemplate(
  fields: CollectField[],
  context: BulkTemplateContext = {},
): string {
  const header: string[] = [];
  if (context.documentLabel) header.push(`Documento: ${context.documentLabel}`);
  if (context.companyName) header.push(`Empresa: ${context.companyName}`);
  if (context.branchName) header.push(`Filial: ${context.branchName}`);

  const lines: string[] = [];
  for (const field of fields) {
    const token = fieldToken(field);
    const suffix = field.required === false ? "   (opcional)" : "";
    if (LIST_TYPES.has(field.type)) {
      lines.push(`${token}:${suffix}`);
      lines.push("* ");
      continue;
    }
    if ((field.options?.length ?? 0) > 0) {
      const values = field.options!.map((option) => option.label).join(" | ");
      lines.push(`${token}:${suffix}   (${values})`);
      continue;
    }
    lines.push(`${token}:${suffix}`);
  }

  const dependencies = fields
    .filter((field) => (field as { depends_on?: string | null }).depends_on)
    .map((field) => {
      const parent = (field as { depends_on?: string | null }).depends_on!;
      const parentField = fields.find((item) => item.key === parent);
      return `• ${fieldToken(field)} depende de ${
        parentField ? fieldToken(parentField) : normalizeToken(parent)
      }`;
    });

  return [
    header.join("\n"),
    "Copie, preencha e envie:",
    lines.join("\n"),
    dependencies.length ? `Dependências:\n${dependencies.join("\n")}` : "",
    "Se preferir, responda *CAMPO* para preencher uma informação por vez.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type BulkParseResult = {
  /** Valores brutos por chave de campo, ainda não validados. */
  values: Record<string, string>;
  /** Tokens enviados que não pertencem ao catálogo da Okton. */
  unknown: string[];
};

/** Separa o texto preenchido em campos. Não adivinha nem completa nada. */
export function parseBulkFill(text: string, fields: CollectField[]): BulkParseResult {
  const tokenMap = new Map<string, string>();
  for (const field of fields) {
    tokenMap.set(fieldToken(field), field.key);
    tokenMap.set(normalizeToken(field.key), field.key);
    if (field.label) tokenMap.set(normalizeToken(field.label), field.key);
  }

  const collected: Record<string, string[]> = {};
  const unknown: string[] = [];
  let current: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^(?:[*\-•]\s*)?([^:]{1,80}?)\s*:\s*(.*)$/);
    if (match) {
      const key = tokenMap.get(normalizeToken(match[1]));
      if (key) {
        current = key;
        collected[key] = collected[key] ?? [];
        const value = match[2].trim();
        if (value) collected[key].push(value);
        continue;
      }
      if (current) {
        collected[current].push(line.replace(/^[*\-•]\s*/, ""));
        continue;
      }
      if (match[1].trim()) unknown.push(match[1].trim());
      continue;
    }

    const plain = line.replace(/^[*\-•]\s*/, "").trim();
    if (!plain) continue;
    if (current) collected[current].push(plain);
    else unknown.push(plain);
  }

  const values: Record<string, string> = {};
  for (const field of fields) {
    const parts = collected[field.key];
    if (!parts || parts.length === 0) continue;
    const joined = LIST_TYPES.has(field.type) ? parts.join("\n") : parts.join(" ").trim();
    if (joined) values[field.key] = joined;
  }

  return { values, unknown };
}

/** Eco dos campos identificados, antes de validar na Okton. */
export function describeParsed(fields: CollectField[], values: Record<string, string>): string {
  const lines = fields
    .filter((field) => values[field.key] !== undefined)
    .map((field) => `• ${field.label}: ${values[field.key].replace(/\n/g, " | ")}`);
  return lines.join("\n");
}
