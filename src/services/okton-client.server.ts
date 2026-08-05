// Cliente central da API Okton.
// TODA comunicação com a Okton deve passar por este serviço.
// Sem regra fiscal, sem cálculo de imposto, sem geração de XML: apenas transporte,
// autenticação, retentativa, logging e padronização de resposta.

import {
  callOkton,
  getConnectionForOrg,
  getEndpoint,
  logIntegration,
  type OktonConnection,
  type OktonEndpoint,
} from "./okton.server";
import {
  parseIdentifyCompany,
  parseRequiredFields,
  parseValidateField,
  type IdentifyCompanyRequest,
  type IdentifyCompanyResult,
  type RequiredFieldsResult,
  type ValidateFieldRequest,
  type ValidateFieldResult,
  parseValidateDocument,
  type ValidateDocumentResult,
} from "@/models/okton-contract";
import { sanitizeForLog } from "@/models/masking";

export type OktonErrorItem = {
  field: string;
  code: string;
  message: string;
};

export type OktonResponse<T = unknown> = {
  success: boolean;
  status_code: number;
  data: T | null;
  message: string;
  errors: OktonErrorItem[];
  request_id: string;
  duration_ms: number;
};

export type OktonRequestOptions = {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  conversationId?: string | null;
};

const SENSITIVE_KEYS = [
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "clientsecret",
  "api_key",
  "apikey",
  "x-api-key",
  "password",
  "senha",
  "secret",
  "certificado",
  "certificate",
];

/** Remove/ofusca dados sensíveis antes de qualquer registro em log (ETAPA 20). */
export function maskSensitive(value: unknown, _depth = 0): unknown {
  return sanitizeForLog(value);
}

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Interpreta os formatos de erro mais comuns devolvidos por APIs REST. */
export function parseErrorItems(data: unknown): OktonErrorItem[] {
  const root = asRecord(data);
  const raw =
    (root?.errors as unknown) ??
    (root?.erros as unknown) ??
    (root?.validation_errors as unknown) ??
    (root?.details as unknown);

  const items: OktonErrorItem[] = [];

  const push = (field: unknown, code: unknown, message: unknown) => {
    items.push({
      field: typeof field === "string" ? field : "",
      code: typeof code === "string" || typeof code === "number" ? String(code) : "",
      message: typeof message === "string" ? message : JSON.stringify(message ?? ""),
    });
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") push("", "", entry);
      else {
        const item = asRecord(entry);
        if (item)
          push(
            item.field ?? item.campo ?? item.path,
            item.code ?? item.codigo,
            item.message ?? item.mensagem ?? item.detail,
          );
      }
    }
  } else {
    const map = asRecord(raw);
    if (map) {
      for (const [field, value] of Object.entries(map)) {
        if (Array.isArray(value)) for (const message of value) push(field, "", message);
        else push(field, "", value);
      }
    }
  }

  return items;
}

function extractMessage(data: unknown, fallback: string) {
  const root = asRecord(data);
  const candidate =
    root?.message ?? root?.mensagem ?? root?.error_description ?? root?.error ?? root?.detail;
  if (typeof candidate === "string" && candidate.trim()) return candidate;
  if (typeof data === "string" && data.trim() && data.length < 400) return data;
  return fallback;
}

function httpMessage(status: number) {
  if (status === 0) return "Não foi possível contatar a Okton.";
  if (status === 400) return "Requisição inválida enviada à Okton.";
  if (status === 401) return "Credenciais da Okton inválidas ou expiradas.";
  if (status === 403) return "Acesso negado pela Okton para esta operação.";
  if (status === 404) return "Recurso não encontrado na Okton.";
  if (status === 409) return "Conflito de dados na Okton.";
  if (status === 422) return "A Okton recusou os dados enviados.";
  if (status === 429) return "Limite de requisições da Okton atingido.";
  if (status >= 500) return "A Okton está indisponível no momento.";
  if (status >= 400) return `A Okton respondeu com erro ${status}.`;
  return "Operação concluída.";
}

function fail(
  status: number,
  message: string,
  requestId: string,
  durationMs: number,
  errors: OktonErrorItem[] = [],
): OktonResponse<never> {
  return {
    success: false,
    status_code: status,
    data: null,
    message,
    errors,
    request_id: requestId,
    duration_ms: durationMs,
  };
}

export class OktonApiClient {
  private constructor(
    readonly organizationId: string | null,
    readonly connection: OktonConnection | null,
    readonly conversationId: string | null,
  ) {}

  /** Carrega a conexão ativa da organização. */
  static async forOrganization(
    organizationId: string | null,
    options: { conversationId?: string | null } = {},
  ) {
    const connection = await getConnectionForOrg(organizationId);
    return new OktonApiClient(organizationId, connection, options.conversationId ?? null);
  }

  static fromConnection(
    connection: OktonConnection,
    options: { conversationId?: string | null } = {},
  ) {
    return new OktonApiClient(
      connection.organization_id,
      connection,
      options.conversationId ?? null,
    );
  }

  get isReady() {
    return this.connection !== null;
  }

  /** Ponto único de saída para a Okton. */
  async request<T = unknown>(
    endpointKey: string,
    options: OktonRequestOptions = {},
  ): Promise<OktonResponse<T>> {
    const requestId = newRequestId();
    const started = Date.now();
    const conversationId = options.conversationId ?? this.conversationId;

    if (!this.connection) {
      const response = fail(
        0,
        "Nenhuma conexão Okton ativa configurada.",
        requestId,
        Date.now() - started,
        [
          {
            field: "connection",
            code: "no_active_connection",
            message: "Configure e ative uma conexão na página Integração Okton.",
          },
        ],
      );
      await this.log(endpointKey, null, response, options, conversationId);
      return response as OktonResponse<T>;
    }

    let endpoint: OktonEndpoint | null = null;
    try {
      endpoint = await getEndpoint(this.connection.id, endpointKey);
    } catch {
      endpoint = null;
    }

    if (!endpoint) {
      const response = fail(
        0,
        `Endpoint "${endpointKey}" não configurado ou inativo.`,
        requestId,
        Date.now() - started,
        [{ field: "endpoint", code: "endpoint_not_configured", message: endpointKey }],
      );
      await this.log(endpointKey, null, response, options, conversationId);
      return response as OktonResponse<T>;
    }

    const result = await callOkton({
      connection: this.connection,
      method: endpoint.method,
      path: endpoint.path,
      pathParams: options.pathParams,
      query: options.query,
      body: options.body,
      idempotencyKey: options.idempotencyKey,
      extraHeaders: endpoint.headers ?? null,
    });

    const durationMs = result.durationMs || Date.now() - started;
    const response: OktonResponse<T> = result.ok
      ? {
          success: true,
          status_code: result.status,
          data: (result.data ?? null) as T | null,
          message: extractMessage(result.data, "Operação realizada com sucesso."),
          errors: [],
          request_id: requestId,
          duration_ms: durationMs,
        }
      : {
          success: false,
          status_code: result.status,
          data: null,
          message: extractMessage(result.data, result.error ?? httpMessage(result.status)),
          errors: parseErrorItems(result.data),
          request_id: requestId,
          duration_ms: durationMs,
        };

    await this.log(endpointKey, endpoint, response, options, conversationId, result.attempts);
    return response;
  }

  private async log(
    endpointKey: string,
    endpoint: OktonEndpoint | null,
    response: OktonResponse<unknown>,
    options: OktonRequestOptions,
    conversationId: string | null,
    attempts?: number,
  ) {
    await logIntegration({
      organizationId: this.organizationId,
      conversationId,
      service: "okton",
      endpoint: endpoint ? `${endpointKey} ${endpoint.path}` : endpointKey,
      method: endpoint?.method,
      statusCode: response.status_code,
      durationMs: response.duration_ms,
      success: response.success,
      errorMessage: response.success ? undefined : response.message,
      requestId: response.request_id,
      environment: this.connection?.environment ?? "producao",
      requestSummary: {
        request_id: response.request_id,
        endpoint_key: endpointKey,
        attempts: attempts ?? 1,
        path_params: maskSensitive(options.pathParams ?? {}),
        query: maskSensitive(options.query ?? {}),
        body: maskSensitive(options.body ?? null),
      },
      responseSummary: {
        request_id: response.request_id,
        received: response.data !== null,
        errors: response.errors.slice(0, 10),
        data: maskSensitive(response.data),
      },
    });
  }

  // ---------------------------------------------------------------------
  // Métodos de operação. Nenhuma regra fiscal aqui: só envio e resposta.
  // ---------------------------------------------------------------------

  /** POST /api/bot/empresas/identificar (caminho configurável em empresa.identificar). */
  identifyCompanyByCnpj(cnpj: string, options: { phoneNumber?: string; channel?: string } = {}) {
    const payload: IdentifyCompanyRequest = {
      cnpj,
      phone_number: options.phoneNumber ?? "",
      channel: options.channel ?? "whatsapp",
    };
    return this.request("empresa.identificar", {
      body: payload,
      pathParams: { cnpj },
      query: { cnpj },
    });
  }

  /** Identificação já normalizada segundo o contrato da Okton. */
  async identifyCompany(
    cnpj: string,
    options: { phoneNumber?: string; channel?: string } = {},
  ): Promise<OktonResponse<IdentifyCompanyResult>> {
    const response = await this.identifyCompanyByCnpj(cnpj, options);
    if (!response.success) {
      return { ...response, data: null } as OktonResponse<IdentifyCompanyResult>;
    }
    const parsed = parseIdentifyCompany(response.data);
    return {
      ...response,
      success: parsed.found,
      data: parsed,
      message: parsed.found ? response.message : parsed.message,
      errors: parsed.found ? [] : [{ field: "cnpj", code: parsed.code, message: parsed.message }],
    };
  }

  listBranches(cnpj: string) {
    return this.request("filial.listar", { pathParams: { cnpj }, query: { cnpj } });
  }

  listAllowedDocuments(cnpj: string, branchId?: string) {
    return this.request("documento.permitidos", {
      pathParams: { cnpj },
      query: { cnpj, filial_id: branchId },
    });
  }

  /** GET /api/bot/documentos/{tipo}/campos?empresa_id=&filial_id= */
  getRequiredFields(
    documentType: string,
    params: Record<string, string | number | undefined> = {},
  ) {
    return this.request("campos.necessarios", {
      pathParams: { tipo: documentType },
      query: { tipo: documentType, ...params },
    });
  }

  /** Campos necessários já normalizados segundo o contrato. */
  async getRequiredFieldsParsed(
    documentType: string,
    params: { companyId?: string | number; branchId?: string | number | null } = {},
  ): Promise<OktonResponse<RequiredFieldsResult>> {
    const response = await this.getRequiredFields(documentType, {
      empresa_id: params.companyId ?? undefined,
      filial_id: params.branchId ?? undefined,
    });
    if (!response.success)
      return { ...response, data: null } as OktonResponse<RequiredFieldsResult>;
    return { ...response, data: parseRequiredFields(response.data, documentType) };
  }

  /** POST /api/bot/documentos/validar-campo (caminho configurável em campo.validar). */
  validateField(
    documentType: string,
    field: string,
    value: unknown,
    context: {
      companyId?: string | number;
      branchId?: string | number | null;
      draftData?: Record<string, unknown>;
    } = {},
  ) {
    const payload: ValidateFieldRequest = {
      company_id: context.companyId ?? "",
      branch_id: context.branchId ?? null,
      document_type: documentType,
      field,
      value,
      draft_data: context.draftData ?? {},
    };
    return this.request("campo.validar", { pathParams: { tipo: documentType }, body: payload });
  }

  /** Validação de campo já normalizada segundo o contrato. */
  async validateFieldParsed(
    documentType: string,
    field: string,
    value: unknown,
    context: {
      companyId?: string | number;
      branchId?: string | number | null;
      draftData?: Record<string, unknown>;
    } = {},
  ): Promise<OktonResponse<ValidateFieldResult>> {
    const response = await this.validateField(documentType, field, value, context);
    // 422 é resposta de negócio: a Okton recusou o valor, não é falha de transporte.
    const parsed = parseValidateField(response.data, field);
    if (!response.success && response.status_code === 0) {
      return { ...response, data: null } as OktonResponse<ValidateFieldResult>;
    }
    return {
      ...response,
      success: parsed.valid,
      data: parsed,
      message: parsed.valid ? response.message : parsed.message,
      errors: parsed.valid
        ? []
        : [{ field: parsed.field, code: parsed.code, message: parsed.message }],
    };
  }

  searchCustomer(params: Record<string, string | number | undefined>) {
    return this.request("cliente.buscar", { query: params });
  }

  searchProduct(params: Record<string, string | number | undefined>) {
    return this.request("produto.buscar", { query: params });
  }

  searchCarrier(params: Record<string, string | number | undefined>) {
    return this.request("transportadora.buscar", { query: params });
  }

  searchVehicle(params: Record<string, string | number | undefined>) {
    return this.request("veiculo.buscar", { query: params });
  }

  searchDriver(params: Record<string, string | number | undefined>) {
    return this.request("motorista.buscar", { query: params });
  }

  createDraft(payload: Record<string, unknown>, idempotencyKey?: string) {
    return this.request("rascunho.criar", { body: payload, idempotencyKey });
  }

  updateDraft(draftId: string, payload: Record<string, unknown>, idempotencyKey?: string) {
    return this.request("rascunho.atualizar", {
      pathParams: { id: draftId },
      body: payload,
      idempotencyKey,
    });
  }

  getDraft(draftId: string) {
    return this.request("rascunho.consultar", { pathParams: { id: draftId } });
  }

  validateDocument(payload: Record<string, unknown>) {
    return this.request("documento.validar", { body: payload });
  }

  /** ETAPA 14 — validação final: o resumo e o token vêm da Okton. */
  async validateDocumentParsed(
    documentType: string,
    payload: Record<string, unknown>,
  ): Promise<OktonResponse<ValidateDocumentResult>> {
    const response = await this.validateDocument(payload);
    if (!response.success && response.status_code === 0) {
      return { ...response, data: null } as OktonResponse<ValidateDocumentResult>;
    }
    const parsed = parseValidateDocument(response.data, documentType);
    return {
      ...response,
      success: parsed.valid,
      data: parsed,
      message: parsed.valid ? response.message : parsed.message,
      errors: parsed.valid
        ? []
        : parsed.errors.map((item) => ({
            field: item.field,
            code: parsed.code,
            message: item.message,
          })),
    };
  }

  issueDocument(payload: Record<string, unknown>, idempotencyKey?: string) {
    return this.request("documento.emitir", { body: payload, idempotencyKey });
  }

  getDocumentStatus(documentId: string) {
    return this.request("documento.status", { pathParams: { id: documentId } });
  }

  getDocumentFiles(documentId: string) {
    return this.request("documento.arquivos", { pathParams: { id: documentId } });
  }

  cancelRequest(documentId: string, reason?: string) {
    return this.request("solicitacao.cancelar", {
      pathParams: { id: documentId },
      body: { motivo: reason ?? null },
    });
  }
}

/** Atalho: cria o cliente da organização e executa uma operação. */
export async function withOktonClient<T>(
  organizationId: string | null,
  run: (client: OktonApiClient) => Promise<T>,
  options: { conversationId?: string | null } = {},
) {
  const client = await OktonApiClient.forOrganization(organizationId, options);
  return run(client);
}
