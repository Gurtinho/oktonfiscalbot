// Helpers server-only usados pelas server functions do painel.
import {
  buildAuthHeaders,
  callOkton,
  callOktonByKey,
  getConnectionForOrg,
  logAudit,
} from "./okton.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const DEFAULT_ENDPOINTS: Array<{
  key: string;
  method: string;
  path: string;
  description: string;
}> = [
  // Catálogo oficial de operações da Okton (caminhos padrão do contrato — editáveis no painel)
  {
    key: "empresa.identificar",
    method: "POST",
    path: "/api/bot/empresas/identificar",
    description: "Identificar empresa por CNPJ",
  },
  {
    key: "filial.listar",
    method: "GET",
    path: "/api/bot/empresas/{cnpj}/filiais",
    description: "Listar filiais",
  },
  {
    key: "documento.permitidos",
    method: "GET",
    path: "/api/bot/empresas/{cnpj}/documentos",
    description: "Listar documentos permitidos",
  },
  {
    key: "campos.necessarios",
    method: "GET",
    path: "/api/bot/documentos/{tipo}/campos",
    description: "Buscar campos necessários",
  },
  {
    key: "campo.validar",
    method: "POST",
    path: "/api/bot/documentos/validar-campo",
    description: "Validar campo",
  },
  {
    key: "cliente.buscar",
    method: "GET",
    path: "/api/bot/clientes",
    description: "Buscar cliente",
  },
  {
    key: "produto.buscar",
    method: "GET",
    path: "/api/bot/produtos",
    description: "Buscar produto",
  },
  {
    key: "transportadora.buscar",
    method: "GET",
    path: "/api/bot/transportadoras",
    description: "Buscar transportadora",
  },
  {
    key: "veiculo.buscar",
    method: "GET",
    path: "/api/bot/veiculos",
    description: "Buscar veículo",
  },
  {
    key: "motorista.buscar",
    method: "GET",
    path: "/api/bot/motoristas",
    description: "Buscar motorista",
  },
  {
    key: "rascunho.criar",
    method: "POST",
    path: "/api/bot/rascunhos",
    description: "Criar rascunho",
  },
  {
    key: "rascunho.atualizar",
    method: "PUT",
    path: "/api/bot/rascunhos/{id}",
    description: "Atualizar rascunho",
  },
  {
    key: "rascunho.consultar",
    method: "GET",
    path: "/api/bot/rascunhos/{id}",
    description: "Consultar rascunho",
  },
  {
    key: "documento.validar",
    method: "POST",
    path: "/api/bot/documentos/validar",
    description: "Validar documento completo",
  },
  {
    key: "documento.emitir",
    method: "POST",
    path: "/api/bot/documentos/emitir",
    description: "Emitir documento",
  },
  {
    key: "documento.status",
    method: "GET",
    path: "/api/bot/documentos/{id}/status",
    description: "Consultar status",
  },
  {
    key: "documento.arquivos",
    method: "GET",
    path: "/api/bot/documentos/{id}/arquivos",
    description: "Consultar arquivos (XML e PDF)",
  },
  {
    key: "solicitacao.cancelar",
    method: "POST",
    path: "/api/bot/documentos/{id}/cancelar",
    description: "Cancelar solicitação",
  },

  // Chaves já usadas pelo motor de conversa (mantidas para compatibilidade)
  {
    key: "empresa.consultar",
    method: "GET",
    path: "/empresas/{cnpj}",
    description: "Consulta empresa por CNPJ",
  },
  {
    key: "nfe.campos",
    method: "GET",
    path: "/nfe/campos",
    description: "Campos obrigatórios da NF-e",
  },
  {
    key: "nfe.validar",
    method: "POST",
    path: "/nfe/validar",
    description: "Validação de campos da NF-e",
  },
  { key: "nfe.emitir", method: "POST", path: "/nfe/emitir", description: "Emissão de NF-e" },
  { key: "nfe.status", method: "GET", path: "/nfe/{id}/status", description: "Status da NF-e" },
  {
    key: "cte.campos",
    method: "GET",
    path: "/cte/campos",
    description: "Campos obrigatórios do CT-e",
  },
  {
    key: "cte.validar",
    method: "POST",
    path: "/cte/validar",
    description: "Validação de campos do CT-e",
  },
  { key: "cte.emitir", method: "POST", path: "/cte/emitir", description: "Emissão de CT-e" },
  { key: "cte.status", method: "GET", path: "/cte/{id}/status", description: "Status do CT-e" },
  {
    key: "mdfe.campos",
    method: "GET",
    path: "/mdfe/campos",
    description: "Campos obrigatórios do MDF-e",
  },
  {
    key: "mdfe.validar",
    method: "POST",
    path: "/mdfe/validar",
    description: "Validação de campos do MDF-e",
  },
  { key: "mdfe.emitir", method: "POST", path: "/mdfe/emitir", description: "Emissão de MDF-e" },
  { key: "mdfe.status", method: "GET", path: "/mdfe/{id}/status", description: "Status do MDF-e" },
];

export async function requireConfigurator(userId: string) {
  const { data } = await supabaseAdmin
    .from("app_users")
    .select("id,organization_id,role,status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active" || !["admin", "gestor"].includes(data.role)) {
    throw new Error("Permissão negada: apenas administradores e gestores.");
  }
  return data;
}

export async function runConnectionTest(
  connectionId: string,
  endpointKey: string | undefined,
  userId: string,
) {
  const actor = await requireConfigurator(userId);
  const { data: connection } = await supabaseAdmin
    .from("api_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("organization_id", actor.organization_id)
    .maybeSingle();

  if (!connection)
    return {
      ok: false,
      status: 0,
      error: "Conexão não encontrada.",
      durationMs: 0,
      testedAt: new Date().toISOString(),
      message: "Conexão não encontrada.",
      attempts: 0,
      credentialsConfigured: false,
    };

  let path = "/";
  let method = "GET";
  let extraHeaders: Record<string, unknown> | null = null;
  if (endpointKey) {
    const { data: endpoint } = await supabaseAdmin
      .from("api_endpoints")
      .select("*")
      .eq("connection_id", connectionId)
      .eq("key", endpointKey)
      .maybeSingle();
    if (endpoint) {
      path = endpoint.path;
      method = endpoint.method;
      extraHeaders = (endpoint.headers as Record<string, unknown> | null) ?? null;
    }
  }

  const conn = connection as unknown as Parameters<typeof callOkton>[0]["connection"];
  const { missing } = buildAuthHeaders(conn);
  const result = await callOkton({ connection: conn, method, path, extraHeaders });
  const testedAt = new Date().toISOString();
  const message = result.ok
    ? `Conexão realizada com sucesso (HTTP ${result.status}).`
    : (result.error ?? `Falha na conexão (HTTP ${result.status}).`);

  await supabaseAdmin
    .from("api_connections")
    .update({
      last_test_at: testedAt,
      last_test_ok: result.ok,
      last_test_status: result.status,
      last_test_duration_ms: result.durationMs,
      last_test_message: message,
    })
    .eq("id", connectionId);

  await logAudit({
    organizationId: actor.organization_id,
    appUserId: actor.id,
    action: "okton.connection.test",
    entityType: "api_connection",
    entityId: connectionId,
    newData: { status: result.status, error: result.error, endpointKey, testedAt },
  });

  return {
    ok: result.ok,
    status: result.status,
    error: result.error,
    message,
    durationMs: result.durationMs,
    attempts: result.attempts ?? 1,
    testedAt,
    credentialsConfigured: missing.length === 0,
  };
}

export async function runEndpointCall(
  input: {
    endpointKey: string;
    body?: unknown;
    query?: Record<string, string>;
    pathParams?: Record<string, string>;
  },
  userId: string,
) {
  const actor = await requireConfigurator(userId);
  const connection = await getConnectionForOrg(actor.organization_id);
  if (!connection)
    return { ok: false, status: 0, dataJson: "null", error: "Nenhuma conexão Okton ativa." };

  const result = await callOktonByKey({
    organizationId: actor.organization_id,
    endpointKey: input.endpointKey,
    body: input.body,
    query: input.query,
    pathParams: input.pathParams,
  });

  await logAudit({
    organizationId: actor.organization_id,
    appUserId: actor.id,
    action: `okton.${input.endpointKey}`,
    entityType: "api_endpoint",
    newData: { status: result.status, error: result.error },
  });

  // devolvido como texto JSON para manter o retorno serializável
  const dataJson = JSON.stringify(result.data ?? null);
  return { ok: result.ok, status: result.status, dataJson, error: result.error };
}

export async function createDefaultEndpoints(connectionId: string, userId: string) {
  const actor = await requireConfigurator(userId);
  // Garante que a conexão pertence à organização do usuário.
  const { data: connection } = await supabaseAdmin
    .from("api_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("organization_id", actor.organization_id)
    .maybeSingle();
  if (!connection) return { ok: false, error: "Conexão não encontrada nesta organização." };

  const rows = DEFAULT_ENDPOINTS.map((endpoint) => ({
    connection_id: connectionId,
    key: endpoint.key,
    method: endpoint.method,
    path: endpoint.path,
    description: endpoint.description,
  }));
  const { error } = await supabaseAdmin
    .from("api_endpoints")
    .upsert(rows, { onConflict: "connection_id,key", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: rows.length };
}
