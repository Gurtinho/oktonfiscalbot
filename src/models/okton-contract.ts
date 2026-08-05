// Contrato esperado da API Okton (ETAPA 5).
// Este arquivo NÃO implementa a API Okton: apenas descreve o contrato e normaliza
// as respostas recebidas. Os caminhos continuam configuráveis no painel
// (Integração Okton → Endpoints); aqui ficam só os tipos e os parsers.

export type OktonBranch = {
  id: string | number;
  name: string;
  active: boolean;
};

export type OktonCompany = {
  id: string | number;
  cnpj: string;
  name: string;
  status: string;
};

export type IdentifyCompanyRequest = {
  cnpj: string;
  phone_number: string;
  channel: string;
};

export type IdentifyCompanyResult =
  | {
      found: true;
      company: OktonCompany;
      branches: OktonBranch[];
      allowed_documents: string[];
    }
  | {
      found: false;
      code: string;
      message: string;
    };

export type OktonFieldOption = { value: string; label: string };

export type OktonFieldType =
  "text" | "number" | "select" | "date" | "cpf_cnpj" | "currency" | "boolean" | string;

export type OktonField = {
  key: string;
  label: string;
  description: string | null;
  type: OktonFieldType;
  required: boolean;
  order: number;
  options: OktonFieldOption[];
  depends_on: string | null;
  validation_mode: "remote" | "local" | string;
};

export type RequiredFieldsResult = {
  document_type: string;
  version: string;
  fields: OktonField[];
};

export type ValidateFieldRequest = {
  company_id: string | number;
  branch_id: string | number | null;
  document_type: string;
  field: string;
  value: unknown;
  draft_data: Record<string, unknown>;
};

export type ValidateFieldResult =
  | {
      valid: true;
      normalized_value: unknown;
      display_value: string | null;
      resolved_data: Record<string, unknown>;
      next_action: string;
    }
  | {
      valid: false;
      field: string;
      code: string;
      message: string;
      suggestions: string[];
    };

// ---------------------------------------------------------------------------
// Parsers tolerantes: aceitam o contrato oficial e variações comuns de nomes.
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string")
    return ["true", "1", "sim", "yes", "ativo"].includes(value.toLowerCase());
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseBranches(value: unknown): OktonBranch[] {
  return list(value).map((raw, index) => {
    const item = record(raw);
    return {
      id: (item.id as string | number) ?? index,
      name: str(item.name ?? item.nome, `Filial ${index + 1}`),
      active: bool(item.active ?? item.ativo, true),
    };
  });
}

export function parseIdentifyCompany(data: unknown): IdentifyCompanyResult {
  const root = record(data);
  const companyRaw = record(root.company ?? root.empresa);
  const success =
    root.success === undefined ? Object.keys(companyRaw).length > 0 : bool(root.success);

  if (!success || Object.keys(companyRaw).length === 0) {
    return {
      found: false,
      code: str(root.code ?? root.codigo, "COMPANY_NOT_FOUND"),
      message: str(root.message ?? root.mensagem, "Empresa não cadastrada na Okton"),
    };
  }

  return {
    found: true,
    company: {
      id: (companyRaw.id as string | number) ?? "",
      cnpj: str(companyRaw.cnpj),
      name: str(companyRaw.name ?? companyRaw.nome ?? companyRaw.razao_social),
      status: str(companyRaw.status, "active"),
    },
    branches: parseBranches(root.branches ?? root.filiais),
    allowed_documents: list(root.allowed_documents ?? root.documentos_permitidos)
      .map((item) => str(item).toLowerCase())
      .filter(Boolean),
  };
}

export function parseFieldOptions(value: unknown): OktonFieldOption[] {
  return list(value).map((raw) => {
    if (typeof raw === "string") return { value: raw, label: raw };
    const item = record(raw);
    const optionValue = str(item.value ?? item.valor);
    return { value: optionValue, label: str(item.label ?? item.rotulo, optionValue) };
  });
}

export function parseRequiredFields(data: unknown, fallbackType = ""): RequiredFieldsResult {
  const root = record(data);
  const fields = list(root.fields ?? root.campos).map((raw, index) => {
    const item = record(raw);
    return {
      key: str(item.key ?? item.chave ?? item.campo),
      label: str(item.label ?? item.rotulo, str(item.key)),
      description:
        item.description || item.descricao ? str(item.description ?? item.descricao) : null,
      type: str(item.type ?? item.tipo, "text"),
      required: bool(item.required ?? item.obrigatorio, true),
      order: typeof item.order === "number" ? item.order : index + 1,
      options: parseFieldOptions(item.options ?? item.opcoes),
      depends_on: item.depends_on ? str(item.depends_on) : null,
      validation_mode: str(item.validation_mode ?? item.modo_validacao, "remote"),
    } satisfies OktonField;
  });

  return {
    document_type: str(root.document_type ?? root.tipo_documento, fallbackType),
    version: str(root.version ?? root.versao, "1"),
    fields: fields.sort((a, b) => a.order - b.order),
  };
}

export function parseValidateField(data: unknown, field: string): ValidateFieldResult {
  const root = record(data);
  const valid = bool(root.valid ?? root.valido, false);

  if (!valid) {
    return {
      valid: false,
      field: str(root.field ?? root.campo, field),
      code: str(root.code ?? root.codigo, "FIELD_INVALID"),
      message: str(root.message ?? root.mensagem, "Valor não aceito pela Okton."),
      suggestions: list(root.suggestions ?? root.sugestoes)
        .map((item) => str(item))
        .filter(Boolean),
    };
  }

  return {
    valid: true,
    normalized_value: root.normalized_value ?? root.valor_normalizado ?? null,
    display_value:
      root.display_value || root.valor_exibicao
        ? str(root.display_value ?? root.valor_exibicao)
        : null,
    resolved_data: record(root.resolved_data ?? root.dados_resolvidos),
    next_action: str(root.next_action ?? root.proxima_acao, "continue"),
  };
}

// ---------------------------------------------------------------------------
// ETAPA 14 — validação final do documento e resumo devolvido pela Okton.
// O resumo apresentado ao usuário vem da Okton; nada é calculado aqui.
// ---------------------------------------------------------------------------

export type OktonSummaryItem = {
  description: string;
  detail: string | null;
};

export type OktonSummary = {
  document_type: string;
  company: string;
  branch: string;
  recipient: string;
  items: OktonSummaryItem[];
  totals: Array<{ label: string; value: string }>;
  raw: Record<string, unknown>;
};

export type ValidateDocumentResult =
  | {
      valid: true;
      draft_id: string | null;
      summary: OktonSummary | null;
      confirmation_token: string | null;
      expires_in_seconds: number | null;
    }
  | {
      valid: false;
      code: string;
      message: string;
      errors: Array<{ field: string; message: string }>;
    };

const TOTAL_LABELS: Record<string, string> = {
  products: "Produtos",
  produtos: "Produtos",
  services: "Serviços",
  servicos: "Serviços",
  freight: "Frete",
  frete: "Frete",
  discount: "Desconto",
  desconto: "Desconto",
  taxes: "Tributos",
  tributos: "Tributos",
  document: "Total do documento",
  documento: "Total do documento",
  total: "Total do documento",
};

function money(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric)) return str(value, "-");
  return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseSummaryItems(value: unknown): OktonSummaryItem[] {
  return list(value).map((raw, index) => {
    if (typeof raw === "string") return { description: raw, detail: null };
    const item = record(raw);
    const description = str(
      item.description ?? item.descricao ?? item.name ?? item.nome ?? item.key ?? item.chave,
      `Item ${index + 1}`,
    );
    const quantity = item.quantity ?? item.quantidade;
    const unit = item.unit_value ?? item.valor_unitario;
    const total = item.total ?? item.valor_total;
    const detail = [
      quantity !== undefined ? `Qtd: ${str(quantity)}` : "",
      unit !== undefined ? `Unit.: ${money(unit)}` : "",
      total !== undefined ? `Total: ${money(total)}` : "",
    ]
      .filter(Boolean)
      .join("  ");
    return { description, detail: detail || null };
  });
}

export function parseDocumentSummary(value: unknown, fallbackType = ""): OktonSummary {
  const root = record(value);
  const totalsRecord = record(root.totals ?? root.totais);
  const totals = Object.entries(totalsRecord).map(([key, item]) => ({
    label: TOTAL_LABELS[key.toLowerCase()] ?? key,
    value: money(item),
  }));
  return {
    document_type: str(root.document_type ?? root.tipo_documento, fallbackType),
    company: str(root.company ?? root.empresa),
    branch: str(root.branch ?? root.filial),
    recipient: str(root.recipient ?? root.destinatario ?? root.tomador),
    items: parseSummaryItems(root.items ?? root.itens ?? root.documentos),
    totals,
    raw: root,
  };
}

export function parseValidateDocument(data: unknown, fallbackType = ""): ValidateDocumentResult {
  const root = record(data);
  const valid = bool(root.valid ?? root.valido, false);

  if (!valid) {
    return {
      valid: false,
      code: str(root.code ?? root.codigo, "DOCUMENT_INVALID"),
      message: str(root.message ?? root.mensagem, "A Okton não aprovou o documento."),
      errors: list(root.errors ?? root.erros).map((raw) => {
        const item = record(raw);
        return {
          field: str(item.field ?? item.campo),
          message: str(item.message ?? item.mensagem, "Informação inválida."),
        };
      }),
    };
  }

  const summaryRaw = root.summary ?? root.resumo;
  const expires = root.expires_in_seconds ?? root.expira_em ?? root.expires_in;
  return {
    valid: true,
    draft_id: root.draft_id || root.rascunho_id ? str(root.draft_id ?? root.rascunho_id) : null,
    summary: summaryRaw ? parseDocumentSummary(summaryRaw, fallbackType) : null,
    confirmation_token:
      root.confirmation_token || root.token_confirmacao
        ? str(root.confirmation_token ?? root.token_confirmacao)
        : null,
    expires_in_seconds: typeof expires === "number" ? expires : Number(expires) || null,
  };
}

// ---------------------------------------------------------------------------
// ETAPA 17 — rejeições devolvidas pela Okton
// ---------------------------------------------------------------------------

export type OktonRejection = {
  /** Código de rejeição da SEFAZ/Okton (ex.: 539, E_DEST_IE). */
  code: string;
  /** Mensagem simplificada devolvida pela Okton, para o cliente no WhatsApp. */
  friendly_message: string;
  /** Mensagem técnica completa, exibida apenas no painel administrativo. */
  technical_message: string;
  /** Chave do campo relacionado, quando a Okton indicar. */
  field: string | null;
  /** Rótulo amigável do campo relacionado. */
  field_label: string | null;
  /** A Okton indicou que o problema é corrigível pelo usuário. */
  correctable: boolean;
  raw: Record<string, unknown>;
};

/** Normaliza a rejeição em qualquer um dos formatos aceitos pelo contrato. */
export function parseRejection(data: unknown): OktonRejection {
  const root = record(data);
  const nested = record(root.rejection ?? root.rejeicao ?? root.error ?? root.erro);
  const src = Object.keys(nested).length > 0 ? nested : root;

  const field = str(src.field ?? src.campo ?? src.field_key ?? src.campo_chave) || null;
  const friendly = str(
    src.friendly_message ??
      src.mensagem_simplificada ??
      src.message_friendly ??
      src.mensagem_amigavel ??
      src.message ??
      src.mensagem,
    "A Okton não detalhou o motivo da rejeição.",
  );
  const technical = str(
    src.technical_message ?? src.mensagem_tecnica ?? src.detail ?? src.detalhe ?? src.raw_message,
    friendly,
  );
  const correctableRaw = src.correctable ?? src.corrigivel ?? src.fixable;

  return {
    code: str(src.code ?? src.codigo ?? src.rejection_code ?? src.codigo_rejeicao, "SEM_CODIGO"),
    friendly_message: friendly,
    technical_message: technical,
    field,
    field_label: str(src.field_label ?? src.campo_label ?? src.label) || field,
    correctable:
      correctableRaw === undefined ? Boolean(field) : bool(correctableRaw, Boolean(field)),
    raw: src,
  };
}
