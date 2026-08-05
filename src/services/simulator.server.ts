// ETAPA 19 — Simulador de WhatsApp. Usa exatamente o mesmo ConversationEngine
// e o mesmo processador de webhook da Okton; nada de lógica paralela de teste.
import { processInboundMessage } from "./conversation-engine.server";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Row = { [key: string]: JsonValue };

export type SimulatorSnapshot = {
  conversation: Row | null;
  messages: Row[];
  draft: Row | null;
  emissions: Row[];
  logs: Row[];
  webhooks: Row[];
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function actor(authUserId: string) {
  const supabase = await admin();
  const { data } = await supabase
    .from("app_users")
    .select("id, organization_id, name, role, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return data;
}

async function audit(opts: {
  organizationId: string;
  appUserId: string;
  action: string;
  entityId: string | null;
  data?: Row;
}) {
  const supabase = await admin();
  await supabase.from("audit_logs").insert({
    organization_id: opts.organizationId,
    app_user_id: opts.appUserId,
    action: opts.action,
    entity_type: "simulator",
    entity_id: opts.entityId,
    old_data_json: {} as never,
    new_data_json: (opts.data ?? {}) as never,
  });
}

function normalizePhone(phone: string) {
  return phone.replace(/[^0-9]/g, "");
}

const EMPTY_SNAPSHOT: SimulatorSnapshot = {
  conversation: null,
  messages: [],
  draft: null,
  emissions: [],
  logs: [],
  webhooks: [],
};

// Só carrega dados da organização do próprio usuário autenticado.
export async function loadSnapshotForUser(
  authUserId: string,
  phone: string,
): Promise<SimulatorSnapshot> {
  const me = await actor(authUserId);
  if (!me?.organization_id) return EMPTY_SNAPSHOT;
  return loadSnapshot(me.organization_id, phone);
}

export async function loadSnapshot(
  organizationId: string,
  phone: string,
): Promise<SimulatorSnapshot> {
  const supabase = await admin();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("phone_number", normalizePhone(phone))
    .order("last_interaction_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    return { conversation: null, messages: [], draft: null, emissions: [], logs: [], webhooks: [] };
  }

  const [messages, draft, emissions, logs, webhooks] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("received_at", { nullsFirst: false }),
    supabase
      .from("drafts")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("emissions")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("integration_logs")
      .select("*")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("webhook_events")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("provider", "okton")
      .order("received_at", { ascending: false })
      .limit(20),
  ]);

  return {
    conversation: conversation as unknown as Row,
    messages: (messages.data ?? []) as unknown as Row[],
    draft: (draft.data ?? null) as unknown as Row | null,
    emissions: (emissions.data ?? []) as unknown as Row[],
    logs: (logs.data ?? []) as unknown as Row[],
    webhooks: (webhooks.data ?? []) as unknown as Row[],
  };
}

export async function simulatorSend(
  input: { organizationId: string; phone: string; text: string },
  authUserId: string,
) {
  const me = await actor(authUserId);
  if (!me) return { ok: false, message: "Usuário sem acesso ativo.", snapshot: null };
  // Segurança: a organização vem sempre do usuário autenticado, nunca do cliente.
  const organizationId = me.organization_id;

  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, message: "Informe um telefone fictício.", snapshot: null };
  const text = (input.text ?? "").trim();
  if (!text) return { ok: false, message: "Mensagem vazia.", snapshot: null };

  // Mesmo ponto de entrada do webhook real do WhatsApp.
  const result = await processInboundMessage({
    organization_id: organizationId,
    phone_number: phone,
    message_content: text,
    message_type: "text",
    message_id: `sim-${crypto.randomUUID()}`,
    simulate: true,
  });

  const snapshot = await loadSnapshot(organizationId, phone);
  return { ok: result.ok, message: `Estado: ${result.state}`, state: result.state, snapshot };
}

export async function simulatorReset(
  input: { organizationId: string; phone: string },
  authUserId: string,
) {
  const me = await actor(authUserId);
  if (!me) return { ok: false, message: "Usuário sem acesso ativo.", snapshot: null };
  // Segurança: a organização vem sempre do usuário autenticado, nunca do cliente.
  const organizationId = me.organization_id;
  const supabase = await admin();
  const phone = normalizePhone(input.phone);

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone_number", phone);

  for (const conversation of conversations ?? []) {
    await supabase.from("emissions").delete().eq("conversation_id", conversation.id);
    await supabase.from("drafts").delete().eq("conversation_id", conversation.id);
    await supabase.from("messages").delete().eq("conversation_id", conversation.id);
    await supabase.from("integration_logs").delete().eq("conversation_id", conversation.id);
    await supabase
      .from("conversations")
      .update({ current_flow_id: null, current_step_id: null })
      .eq("id", conversation.id);
    await supabase.from("conversations").delete().eq("id", conversation.id);
  }

  await audit({
    organizationId,
    appUserId: me.id,
    action: "simulator_reset",
    entityId: null,
    data: { phone, removed: conversations?.length ?? 0 },
  });

  return {
    ok: true,
    message: "Conversa simulada reiniciada.",
    snapshot: await loadSnapshot(organizationId, phone),
  };
}

export async function simulatorSetState(
  input: {
    organizationId: string;
    phone: string;
    status?: string;
    stepId?: string | null;
    botPaused?: boolean;
  },
  authUserId: string,
) {
  const me = await actor(authUserId);
  if (!me) return { ok: false, message: "Usuário sem acesso ativo.", snapshot: null };
  // Segurança: a organização vem sempre do usuário autenticado, nunca do cliente.
  const organizationId = me.organization_id;
  const supabase = await admin();
  const phone = normalizePhone(input.phone);

  const snapshotBefore = await loadSnapshot(organizationId, phone);
  const conversationId = snapshotBefore.conversation?.["id"] as string | undefined;
  if (!conversationId) {
    return { ok: false, message: "Nenhuma conversa simulada ainda.", snapshot: snapshotBefore };
  }

  const patch: Row = { last_interaction_at: new Date().toISOString() };
  if (input.status) patch["status"] = input.status;
  if (input.stepId !== undefined) patch["current_step_id"] = input.stepId || null;
  if (input.botPaused !== undefined) patch["bot_paused"] = input.botPaused;

  const { error } = await supabase
    .from("conversations")
    .update(patch as never)
    .eq("id", conversationId);
  if (error) return { ok: false, message: error.message, snapshot: snapshotBefore };

  await audit({
    organizationId,
    appUserId: me.id,
    action: "simulator_set_state",
    entityId: conversationId,
    data: patch,
  });

  return {
    ok: true,
    message: "Estado alterado.",
    snapshot: await loadSnapshot(organizationId, phone),
  };
}

export type SimulatedWebhook = "authorized" | "rejected" | "timeout" | "custom";

/** Monta o payload no formato do contrato da Okton e reaproveita o processador real. */
export async function simulatorWebhook(
  input: {
    organizationId: string;
    phone: string;
    kind: SimulatedWebhook;
    customPayload?: string;
  },
  authUserId: string,
) {
  const me = await actor(authUserId);
  if (!me) return { ok: false, message: "Usuário sem acesso ativo.", snapshot: null };
  // Segurança: a organização vem sempre do usuário autenticado, nunca do cliente.
  const organizationId = me.organization_id;
  const supabase = await admin();
  const phone = normalizePhone(input.phone);

  const before = await loadSnapshot(organizationId, phone);
  const emission = before.emissions[0] as
    | { id: string; protocol?: string | null; draft_id?: string | null; document_type?: string }
    | undefined;

  if (input.kind !== "custom" && !emission) {
    return {
      ok: false,
      message: "Nenhuma emissão nesta conversa. Conclua o fluxo antes de simular o retorno.",
      snapshot: before,
    };
  }

  let payload: Row;
  if (input.kind === "custom") {
    try {
      payload = JSON.parse(input.customPayload || "{}") as Row;
    } catch {
      return { ok: false, message: "JSON inválido.", snapshot: before };
    }
  } else {
    const base = {
      event_id: `sim-${crypto.randomUUID()}`,
      request_id: emission?.protocol ?? null,
      draft_id: emission?.draft_id ?? null,
      document_type: emission?.document_type ?? "nfe",
    };
    if (input.kind === "authorized") {
      payload = {
        ...base,
        event: "document_authorized",
        status: "authorized",
        number: "1234",
        series: "1",
        access_key: `3526${Date.now()}`.padEnd(44, "0").slice(0, 44),
        protocol: emission?.protocol ?? `SIM-${Date.now()}`,
        files: {
          pdf_url: "https://exemplo.okton/simulado/danfe.pdf",
          xml_url: "https://exemplo.okton/simulado/nota.xml",
        },
      };
    } else if (input.kind === "rejected") {
      payload = {
        ...base,
        event: "document_rejected",
        status: "rejected",
        message: "Rejeição simulada pelo painel.",
        rejection: {
          code: "539",
          friendly_message: "O valor total informado não confere com os itens.",
          technical_message: "Rejeicao 539: duplicidade de NF-e com diferenca na chave de acesso.",
          field: "valor_total",
          field_label: "Valor total",
          correctable: true,
        },
      };
    } else {
      payload = {
        ...base,
        event: "document_error",
        status: "error",
        message: "Timeout simulado: a Okton não respondeu dentro do tempo configurado.",
      };
    }
  }

  const rawBody = JSON.stringify(payload);
  const headers = new Headers({
    "content-type": "application/json",
    "x-simulator": "painel",
  });

  const { processOktonWebhook } = await import("./okton-webhook.server");
  const outcome = await processOktonWebhook(rawBody, headers, { skipSignature: true });

  if (input.kind === "timeout") {
    // Registra também a falha de transporte, como aconteceria em um timeout real.
    await supabase.from("integration_logs").insert({
      organization_id: organizationId,
      conversation_id: (before.conversation?.["id"] as string | undefined) ?? null,
      service: "okton",
      endpoint: "emission_status",
      method: "GET",
      request_summary_json: { simulated: true } as never,
      response_summary_json: {} as never,
      status_code: 504,
      duration_ms: 30000,
      success: false,
      error_message: "Timeout simulado pelo painel.",
    });
  }

  await audit({
    organizationId,
    appUserId: me.id,
    action: `simulator_webhook_${input.kind}`,
    entityId: (before.conversation?.["id"] as string | undefined) ?? null,
    data: { payload, outcome: outcome.body as unknown as Row },
  });

  return {
    ok: outcome.status < 400,
    message: `Webhook simulado (HTTP ${outcome.status}).`,
    outcome: outcome.body as unknown as Row,
    payload,
    snapshot: await loadSnapshot(organizationId, phone),
  };
}
