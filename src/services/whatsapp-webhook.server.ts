// Processamento compartilhado dos webhooks de WhatsApp (ETAPA 8).
import { WhatsAppProvider, type WhatsAppChannelConfig } from "./whatsapp-provider.server";

export type WebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

export async function findChannel(opts: {
  provider?: string;
  token?: string | null;
}): Promise<WhatsAppChannelConfig | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin.from("whatsapp_channels").select("*").eq("active", true);
  if (opts.token) query = query.eq("webhook_token", opts.token);
  if (opts.provider) query = query.eq("provider", opts.provider);
  const { data } = await query.limit(1).maybeSingle();
  return (data as WhatsAppChannelConfig | null) ?? null;
}

function safeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!/authorization|cookie|apikey|token|signature|secret/i.test(key)) out[key] = value;
  });
  return out;
}

/** Já existe uma mensagem recebida com este external_message_id nesta organização? */
async function isDuplicate(
  organizationId: string | null,
  externalMessageId: string | null,
): Promise<boolean> {
  if (!externalMessageId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("messages")
    .select("id, conversations!inner(organization_id)")
    .eq("external_message_id", externalMessageId)
    .eq("direction", "inbound")
    .eq("conversations.organization_id", organizationId ?? "")
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function processWhatsAppWebhook(
  channel: WhatsAppChannelConfig,
  rawBody: string,
  headers: Headers,
): Promise<WebhookOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const provider = new WhatsAppProvider(channel);

  const signature = await provider.validateWebhookSignature(rawBody, headers);
  if (!signature.valid) {
    return { status: 401, body: { ok: false, error: signature.reason ?? "Assinatura inválida" } };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: "Payload inválido" } };
  }

  const parsed = provider.parseIncomingWebhook(payload);

  // Deduplicação pelo identificador externo da mensagem.
  if (parsed.messageId) {
    const { data: seen } = await supabaseAdmin
      .from("webhook_events")
      .select("id")
      .eq("provider", channel.provider)
      .eq("external_event_id", parsed.messageId)
      .limit(1)
      .maybeSingle();
    if (seen || (await isDuplicate(channel.organization_id, parsed.messageId))) {
      return { status: 200, body: { ok: true, duplicated: true } };
    }
  }

  const { data: event } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      organization_id: channel.organization_id,
      provider: channel.provider,
      event_type: parsed.messageType || "message",
      external_event_id: parsed.messageId,
      payload_json: payload as never,
      headers_json: safeHeaders(headers) as never,
      processing_status: "pending",
    })
    .select("id")
    .maybeSingle();

  await supabaseAdmin
    .from("whatsapp_channels")
    .update({ last_event_at: new Date().toISOString(), status: "connected" })
    .eq("id", channel.id);

  const finish = async (status: string, errorMessage?: string) => {
    if (!event) return;
    await supabaseAdmin
      .from("webhook_events")
      .update({
        processing_status: status,
        processed_at: new Date().toISOString(),
        processing_attempts: 1,
        error_message: errorMessage ?? null,
      })
      .eq("id", event.id);
  };

  if (parsed.fromMe || !parsed.phone || !parsed.text) {
    await finish("ignored");
    return { status: 200, body: { ok: true, ignored: true } };
  }

  // teste "sorvete" — só processa mensagens destinadas ao número cadastrado
  // no campo "Número conectado" (phone_number) do canal, na tela de
  // Integração WhatsApp. Se o canal tiver esse campo preenchido e o
  // provedor informar o destinatário (parsed.to), qualquer mensagem para
  // outro número é ignorada — evita responder por um número que não é o
  // cadastrado quando o mesmo endpoint de webhook atende mais de um número
  // no provedor.
  const channelPhone = channel.phone_number?.replace(/[^0-9]/g, "") || null;
  if (channelPhone && parsed.to && parsed.to !== channelPhone) {
    await finish("ignored");
    return { status: 200, body: { ok: true, ignored: true } };
  }
  // teste "sorvete" — fim do bloco

  // ETAPA 20 — limite por telefone e expiração oportunista de rascunhos.
  const { checkRateLimit, expireStaleDrafts } = await import("./security.server");
  const phoneLimit = await checkRateLimit(
    "inbound_phone",
    `${channel.organization_id ?? "sem-org"}:${parsed.phone}`,
    channel.organization_id,
  );
  if (!phoneLimit.allowed) {
    await finish("rate_limited");
    return { status: 429, body: { ok: false, error: "Limite de mensagens excedido" } };
  }
  await expireStaleDrafts();

  const work = (async () => {
    const { handleInboundMessage } = await import("@/services/engine.server");
    try {
      if (parsed.messageId) {
        await provider.markMessageAsRead(parsed.phone!, parsed.messageId);
      }
      await handleInboundMessage({
        channel,
        phone: parsed.phone!,
        name: parsed.name,
        text: parsed.text!,
        messageId: parsed.messageId,
        messageType: parsed.messageType,
        timestamp: parsed.timestamp ?? undefined,
        raw: payload,
      });
      await finish("processed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado";
      await finish("failed", message);
      const { logAudit } = await import("@/services/okton.server");
      await logAudit({
        organizationId: channel.organization_id,
        action: "whatsapp.webhook.error",
        entityType: "whatsapp_channel",
        entityId: channel.id,
        newData: { message },
      });
      console.error("[whatsapp-webhook] erro", message);
    }
  })();

  // Responde 200 rapidamente; o processamento segue em segundo plano quando o
  // runtime permite (waitUntil), caso contrário é aguardado.
  const ctx = (globalThis as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  if (typeof ctx === "function") {
    ctx(work);
  } else {
    await work;
  }

  return { status: 200, body: { ok: true, received: true } };
}
