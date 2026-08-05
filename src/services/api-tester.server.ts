// ETAPA 22 — Banco de testes de API ("Insomnia interno").
// Permite disparar chamadas reais para a Okton e para o provedor de WhatsApp
// a partir do painel, sempre pelo servidor: nenhum token vai para o browser.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildUrl, callOkton, getConnectionForOrg, logAudit } from "./okton.server";
import { requireConfigurator } from "./okton-admin.server";
import { WhatsAppProvider, type WhatsAppChannelConfig } from "./whatsapp-provider.server";

export type TestResult = {
  ok: boolean;
  status: number;
  durationMs: number;
  url: string;
  method: string;
  requestPreview: string;
  responseText: string;
  error?: string;
  ranAt: string;
};

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJsonInput(raw: string | undefined, label: string): unknown {
  const text = (raw ?? "").trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: JSON inválido.`);
  }
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined && item !== null) out[key] = String(item);
  }
  return out;
}

// ---------------------------------------------------------------- Okton ----

export type OktonTestInput = {
  endpointKey?: string | null;
  method?: string;
  path?: string;
  pathParamsJson?: string;
  queryJson?: string;
  bodyJson?: string;
  headersJson?: string;
};

export async function runOktonTest(input: OktonTestInput, userId: string): Promise<TestResult> {
  const actor = await requireConfigurator(userId);
  const ranAt = new Date().toISOString();
  const connection = await getConnectionForOrg(actor.organization_id);
  if (!connection) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      url: "",
      method: input.method ?? "GET",
      requestPreview: "",
      responseText: "",
      error: "Nenhuma conexão Okton ativa configurada.",
      ranAt,
    };
  }

  let method = (input.method || "GET").toUpperCase();
  let path = input.path || "/";
  let endpointHeaders: Record<string, unknown> | null = null;

  if (input.endpointKey) {
    const { data: endpoint } = await supabaseAdmin
      .from("api_endpoints")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("key", input.endpointKey)
      .maybeSingle();
    if (!endpoint) {
      return {
        ok: false,
        status: 0,
        durationMs: 0,
        url: "",
        method,
        requestPreview: "",
        responseText: "",
        error: `Operação "${input.endpointKey}" não cadastrada nesta conexão.`,
        ranAt,
      };
    }
    method = (input.method || endpoint.method).toUpperCase();
    path = input.path || endpoint.path;
    endpointHeaders = (endpoint.headers as Record<string, unknown> | null) ?? null;
  }

  let pathParams: Record<string, string>;
  let query: Record<string, string>;
  let extraHeaders: Record<string, unknown>;
  let body: unknown;
  try {
    pathParams = asRecord(parseJsonInput(input.pathParamsJson, "Parâmetros de caminho"));
    query = asRecord(parseJsonInput(input.queryJson, "Query string"));
    extraHeaders = {
      ...(endpointHeaders ?? {}),
      ...asRecord(parseJsonInput(input.headersJson, "Headers")),
    };
    body = parseJsonInput(input.bodyJson, "Corpo da requisição");
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      url: "",
      method,
      requestPreview: "",
      responseText: "",
      error: error instanceof Error ? error.message : "Entrada inválida.",
      ranAt,
    };
  }

  const conn = connection as unknown as Parameters<typeof callOkton>[0]["connection"];
  const url = buildUrl(conn, path, pathParams, query);
  const result = await callOkton({
    connection: conn,
    method,
    path,
    pathParams,
    query,
    body,
    extraHeaders,
  });

  await logAudit({
    organizationId: actor.organization_id,
    appUserId: actor.id,
    action: "api_tester.okton",
    entityType: "api_connection",
    entityId: connection.id,
    newData: { method, path, status: result.status, endpointKey: input.endpointKey ?? null },
  });

  return {
    ok: result.ok,
    status: result.status,
    durationMs: result.durationMs,
    url,
    method,
    requestPreview: toText(body ?? null),
    responseText: toText(result.data),
    error: result.error,
    ranAt,
  };
}

// ------------------------------------------------------------- WhatsApp ----

export type WhatsAppTestKind = "text" | "options" | "document" | "image";

export type WhatsAppTestInput = {
  channelId: string;
  phone: string;
  kind: WhatsAppTestKind;
  text?: string;
  optionsText?: string;
  mediaUrl?: string;
  fileName?: string;
};

export async function runWhatsAppTest(
  input: WhatsAppTestInput,
  userId: string,
): Promise<TestResult> {
  const actor = await requireConfigurator(userId);
  const ranAt = new Date().toISOString();
  const started = Date.now();

  const { data: channel } = await supabaseAdmin
    .from("whatsapp_channels")
    .select("*")
    .eq("id", input.channelId)
    .eq("organization_id", actor.organization_id)
    .maybeSingle();

  if (!channel) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      url: "",
      method: "POST",
      requestPreview: "",
      responseText: "",
      error: "Canal de WhatsApp não encontrado.",
      ranAt,
    };
  }

  const phone = input.phone.replace(/[^0-9]/g, "");
  if (!phone) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      url: "",
      method: "POST",
      requestPreview: "",
      responseText: "",
      error: "Informe o número de destino com DDI e DDD.",
      ranAt,
    };
  }

  const provider = new WhatsAppProvider(channel as unknown as WhatsAppChannelConfig);
  const text = input.text?.trim() || "Mensagem de teste do Okton Fiscal Bot.";
  let result;
  if (input.kind === "options") {
    const options = (input.optionsText ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    result = await provider.sendOptionsMessage(
      phone,
      text,
      options.length ? options : ["Sim", "Não"],
    );
  } else if (input.kind === "document") {
    result = await provider.sendDocument(
      phone,
      input.mediaUrl ?? "",
      input.fileName || "documento.pdf",
      text,
    );
  } else if (input.kind === "image") {
    result = await provider.sendImage(phone, input.mediaUrl ?? "", text);
  } else {
    result = await provider.sendTextMessage(phone, text);
  }

  const durationMs = Date.now() - started;

  await supabaseAdmin.from("integration_logs").insert({
    organization_id: actor.organization_id,
    service: "whatsapp",
    endpoint: `test.${input.kind}`,
    method: "POST",
    request_summary_json: { phone: `${phone.slice(0, 4)}****`, kind: input.kind } as never,
    response_summary_json: { data: toText(result.data).slice(0, 2000) } as never,
    status_code: result.status ?? 0,
    duration_ms: durationMs,
    success: result.ok,
    error_message: result.error ?? null,
  });

  await logAudit({
    organizationId: actor.organization_id,
    appUserId: actor.id,
    action: "api_tester.whatsapp",
    entityType: "whatsapp_channel",
    entityId: channel.id,
    newData: { kind: input.kind, status: result.status ?? 0, ok: result.ok },
  });

  return {
    ok: result.ok,
    status: result.status ?? 0,
    durationMs,
    url: channel.send_url || channel.base_url || "",
    method: "POST",
    requestPreview: toText({ phone, kind: input.kind, text }),
    responseText: toText(result.data),
    error: result.error,
    ranAt,
  };
}

// ------------------------------------------------- Coleção para Insomnia ----

export async function buildInsomniaCollection(appOrigin: string, userId: string) {
  const actor = await requireConfigurator(userId);
  const connection = await getConnectionForOrg(actor.organization_id);
  const { data: endpoints } = connection
    ? await supabaseAdmin
        .from("api_endpoints")
        .select("*")
        .eq("connection_id", connection.id)
        .order("key", { ascending: true })
    : {
        data: [] as Array<{
          key: string;
          method: string;
          path: string;
          description: string | null;
        }>,
      };

  const { data: channels } = await supabaseAdmin
    .from("whatsapp_channels")
    .select("id, display_name, provider, base_url, send_url, instance_name, webhook_token")
    .eq("organization_id", actor.organization_id);

  const now = Date.now();
  const resources: Array<Record<string, unknown>> = [
    {
      _id: "wrk_okton",
      _type: "workspace",
      name: "Okton Fiscal Bot",
      description: "Coleção exportada pelo painel — preencha os tokens nas variáveis do ambiente.",
    },
    {
      _id: "env_base",
      _type: "environment",
      parentId: "wrk_okton",
      name: "Base",
      data: {
        okton_base_url: connection?.base_url ?? "https://api.okton.exemplo",
        okton_token: "COLE_SEU_TOKEN_AQUI",
        app_url: appOrigin,
        whatsapp_token: "COLE_O_TOKEN_DO_PROVEDOR",
      },
      isPrivate: false,
    },
    { _id: "fld_okton", _type: "request_group", parentId: "wrk_okton", name: "Okton" },
    { _id: "fld_whatsapp", _type: "request_group", parentId: "wrk_okton", name: "WhatsApp" },
    { _id: "fld_webhooks", _type: "request_group", parentId: "wrk_okton", name: "Webhooks do bot" },
  ];

  (endpoints ?? []).forEach((endpoint, index) => {
    const method = endpoint.method.toUpperCase();
    resources.push({
      _id: `req_okton_${index}`,
      _type: "request",
      parentId: "fld_okton",
      name: `${endpoint.key} — ${endpoint.description ?? ""}`.trim(),
      method,
      url: `{{ okton_base_url }}${endpoint.path.startsWith("/") ? "" : "/"}${endpoint.path}`,
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Authorization", value: "Bearer {{ okton_token }}" },
      ],
      body: method === "GET" ? {} : { mimeType: "application/json", text: "{\n  \n}" },
      metaSortKey: now + index,
    });
  });

  (channels ?? []).forEach((channel, index) => {
    resources.push({
      _id: `req_wa_${index}`,
      _type: "request",
      parentId: "fld_whatsapp",
      name: `Enviar texto — ${channel.display_name ?? channel.provider}`,
      method: "POST",
      url: channel.send_url || channel.base_url || "https://provedor.exemplo/send",
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Authorization", value: "Bearer {{ whatsapp_token }}" },
      ],
      body: {
        mimeType: "application/json",
        text: JSON.stringify(
          { instance: channel.instance_name, phone: "5511999999999", message: "Teste" },
          null,
          2,
        ),
      },
      metaSortKey: now + 100 + index,
    });
    resources.push({
      _id: `req_wa_hook_${index}`,
      _type: "request",
      parentId: "fld_webhooks",
      name: `Webhook de entrada — ${channel.display_name ?? channel.provider}`,
      method: "POST",
      url: `{{ app_url }}/api/public/webhooks/whatsapp/${channel.provider}?token=${channel.webhook_token ?? "TOKEN"}`,
      headers: [{ name: "Content-Type", value: "application/json" }],
      body: {
        mimeType: "application/json",
        text: JSON.stringify(
          { phone: "5511999999999", message: "oi", messageId: "teste-1", fromMe: false },
          null,
          2,
        ),
      },
      metaSortKey: now + 200 + index,
    });
  });

  resources.push({
    _id: "req_okton_hook",
    _type: "request",
    parentId: "fld_webhooks",
    name: "Retorno fiscal da Okton",
    method: "POST",
    url: `{{ app_url }}/api/public/webhooks/okton/fiscal`,
    headers: [{ name: "Content-Type", value: "application/json" }],
    body: {
      mimeType: "application/json",
      text: JSON.stringify(
        {
          event: "document_authorized",
          request_id: "PROTOCOLO",
          status: "authorized",
          number: "1234",
          series: "1",
          files: { pdf_url: "https://exemplo/danfe.pdf", xml_url: "https://exemplo/nota.xml" },
        },
        null,
        2,
      ),
    },
    metaSortKey: now + 300,
  });

  return {
    _type: "export",
    __export_format: 4,
    __export_date: new Date().toISOString(),
    __export_source: "okton-fiscal-bot",
    resources,
  };
}
