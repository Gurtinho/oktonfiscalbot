import { maskPhone, sanitizeForLog } from "@/models/masking";
// Cliente HTTP da Okton. TODO acesso à Okton acontece aqui, no backend.
// Nunca expor tokens no frontend, nunca calcular imposto ou gerar XML localmente.

export type OktonConnection = {
  id: string;
  organization_id: string;
  name: string;
  base_url: string;
  authentication_type: string;
  encrypted_credentials_reference: string;
  token_secret_name?: string | null;
  client_id_secret_name?: string | null;
  client_secret_secret_name?: string | null;
  api_key_secret_name?: string | null;
  timeout_seconds: number;
  retry_count?: number | null;
  retry_interval_ms?: number | null;
  environment: string;
  active: boolean;
};

export type OktonEndpoint = {
  id: string;
  key: string;
  method: string;
  path: string;
  active: boolean;
  headers?: Record<string, unknown> | null;
  request_mapping?: Record<string, unknown> | null;
  response_mapping?: Record<string, unknown> | null;
};

export type OktonCallResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
  durationMs: number;
  attempts?: number;
};

function secret(name?: string | null): string | undefined {
  if (!name) return undefined;
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

// Monta os cabeçalhos de autenticação lendo APENAS variáveis de ambiente do servidor.
// O banco guarda somente o NOME do segredo, nunca o valor.
export function buildAuthHeaders(connection: OktonConnection): {
  headers: Record<string, string>;
  missing: string[];
} {
  const headers: Record<string, string> = {};
  const missing: string[] = [];
  const type = (connection.authentication_type || "bearer").toLowerCase();
  const tokenName = connection.token_secret_name || connection.encrypted_credentials_reference;

  if (type === "none") return { headers, missing };

  if (type === "apikey") {
    const apiKeyName = connection.api_key_secret_name || tokenName;
    const apiKey = secret(apiKeyName);
    if (apiKey) headers["x-api-key"] = apiKey;
    else missing.push(apiKeyName ?? "API_KEY");
    return { headers, missing };
  }

  if (type === "basic" || type === "oauth2" || type === "client_credentials") {
    const idName = connection.client_id_secret_name;
    const secretName = connection.client_secret_secret_name;
    const clientId = secret(idName);
    const clientSecret = secret(secretName);
    if (!clientId) missing.push(idName ?? "CLIENT_ID");
    if (!clientSecret) missing.push(secretName ?? "CLIENT_SECRET");
    if (clientId && clientSecret) {
      if (type === "basic") {
        headers["Authorization"] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
      } else {
        headers["X-Client-Id"] = clientId;
        headers["X-Client-Secret"] = clientSecret;
      }
    }
    return { headers, missing };
  }

  const token = secret(tokenName);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else missing.push(tokenName ?? "TOKEN");
  return { headers, missing };
}

function applyPathParams(path: string, params: Record<string, string | number> = {}) {
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    result = result.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
    result = result.replaceAll(`:${key}`, encodeURIComponent(String(value)));
  }
  return result;
}

export function buildUrl(
  connection: Pick<OktonConnection, "base_url">,
  path: string,
  pathParams: Record<string, string | number> = {},
  query: Record<string, string | number | undefined> = {},
) {
  const base = connection.base_url.replace(/\/+$/, "");
  const resolved = applyPathParams(path, pathParams);
  const url = new URL(base + (resolved.startsWith("/") ? resolved : `/${resolved}`));
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function callOkton(options: {
  connection: OktonConnection;
  method: string;
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  extraHeaders?: Record<string, unknown> | null;
}): Promise<OktonCallResult> {
  const started = Date.now();
  const {
    connection,
    method,
    path,
    pathParams = {},
    query = {},
    body,
    idempotencyKey,
    extraHeaders,
  } = options;
  const timeoutMs = Math.max(1, connection.timeout_seconds ?? 30) * 1000;

  const url = buildUrl(connection, path, pathParams, query);
  const { headers: authHeaders, missing } = buildAuthHeaders(connection);

  if (missing.length > 0) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Credencial ausente no servidor: configure o(s) segredo(s) ${missing.join(", ")}.`,
      durationMs: Date.now() - started,
      attempts: 0,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authHeaders,
  };
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    if (typeof value === "string" || typeof value === "number") headers[key] = String(value);
  }
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
    headers["X-Idempotency-Key"] = idempotencyKey;
  }

  const maxAttempts = Math.min(6, Math.max(0, connection.retry_count ?? 0) + 1);
  const retryDelay = Math.max(0, connection.retry_interval_ms ?? 1000);
  let last: OktonCallResult = {
    ok: false,
    status: 0,
    data: null,
    error: "Falha na chamada à Okton",
    durationMs: 0,
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body:
          body !== undefined && method.toUpperCase() !== "GET" ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // resposta não-JSON (ex.: XML/PDF) é mantida como texto
      }

      last = {
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok ? undefined : `Okton respondeu ${response.status}`,
        durationMs: Date.now() - started,
        attempts: attempt,
      };
    } catch (error) {
      last = {
        ok: false,
        status: 0,
        data: null,
        error: error instanceof Error ? error.message : "Falha na chamada à Okton",
        durationMs: Date.now() - started,
        attempts: attempt,
      };
    } finally {
      clearTimeout(timer);
    }

    // repete apenas em falha de rede ou erro do servidor (5xx)
    const retryable = !last.ok && (last.status === 0 || last.status >= 500);
    if (!retryable || attempt === maxAttempts) break;
    if (retryDelay > 0) await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  return last;
}

export async function getConnectionForOrg(organizationId: string | null) {
  if (!organizationId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("api_connections")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as unknown as OktonConnection) ?? null;
}

export async function getEndpoint(connectionId: string, key: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("api_endpoints")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("key", key)
    .eq("active", true)
    .maybeSingle();
  return (data as unknown as OktonEndpoint) ?? null;
}

// Compatibilidade: delega ao OktonApiClient, que é o único ponto de saída para a Okton.
export async function callOktonByKey(options: {
  organizationId: string | null;
  conversationId?: string | null;
  endpointKey: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<OktonCallResult> {
  const { OktonApiClient } = await import("./okton-client.server");
  const client = await OktonApiClient.forOrganization(options.organizationId, {
    conversationId: options.conversationId ?? null,
  });
  const response = await client.request(options.endpointKey, {
    pathParams: options.pathParams,
    query: options.query,
    body: options.body,
    idempotencyKey: options.idempotencyKey,
  });

  return {
    ok: response.success,
    status: response.status_code,
    data: response.data,
    error: response.success ? undefined : response.message,
    durationMs: response.duration_ms,
  };
}

export async function logIntegration(entry: {
  organizationId: string | null;
  conversationId?: string | null;
  service: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  success: boolean;
  errorMessage?: string;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  requestId?: string | null;
  environment?: string | null;
  phoneNumber?: string | null;
  oktonCompanyId?: string | null;
  documentType?: "nfe" | "cte" | "mdfe" | null;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("integration_logs").insert({
      organization_id: entry.organizationId,
      conversation_id: entry.conversationId ?? null,
      service: entry.service,
      endpoint: entry.endpoint ?? null,
      method: entry.method ?? null,
      status_code: entry.statusCode ?? null,
      duration_ms: entry.durationMs ?? null,
      success: entry.success,
      error_message: entry.errorMessage ?? null,
      request_summary_json: (sanitizeForLog(entry.requestSummary ?? {}) ?? {}) as never,
      response_summary_json: (sanitizeForLog(entry.responseSummary ?? {}) ?? {}) as never,
      request_id: entry.requestId ?? null,
      environment: entry.environment ?? "producao",
      phone_masked: entry.phoneNumber ? maskPhone(entry.phoneNumber) : null,
      okton_company_id: entry.oktonCompanyId ?? null,
      document_type: entry.documentType ?? null,
    });
  } catch (error) {
    console.error("[integration_logs] falha ao registrar", error);
  }
}

export async function logAudit(entry: {
  organizationId?: string | null;
  appUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: entry.organizationId ?? null,
      app_user_id: entry.appUserId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      old_data_json: (sanitizeForLog(entry.oldData ?? {}) ?? {}) as never,
      new_data_json: (sanitizeForLog(entry.newData ?? {}) ?? {}) as never,
    });
  } catch (error) {
    console.error("[audit] falha ao registrar log", error);
  }
}
