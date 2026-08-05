// ETAPA 16 — Webhook de retorno da Okton.
// Recebe os eventos fiscais, valida a assinatura configurada no painel,
// evita duplicidade, atualiza a emissão e avisa o cliente pelo WhatsApp.
import { WhatsAppProvider, type WhatsAppChannelConfig } from "./whatsapp-provider.server";

export type OktonWebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

export const OKTON_WEBHOOK_EVENTS = [
  "document_received",
  "document_processing",
  "document_authorized",
  "document_rejected",
  "document_cancelled",
  "document_error",
  "files_available",
] as const;

export type OktonWebhookEvent = (typeof OKTON_WEBHOOK_EVENTS)[number];

const DOC_LABEL: Record<string, string> = { nfe: "NF-e", cte: "CT-e", mdfe: "MDF-e" };

type EmissionStatus = "pending" | "sent" | "authorized" | "rejected" | "error" | "cancelled";

/** Mapeia evento/status da Okton para o status interno da emissão. */
function mapStatus(event: string, status: string): EmissionStatus | null {
  const key = `${event} ${status}`.toLowerCase();
  if (key.includes("authorized") || key.includes("autoriz")) return "authorized";
  if (key.includes("rejected") || key.includes("rejeit")) return "rejected";
  if (key.includes("cancelled") || key.includes("canceled") || key.includes("cancel"))
    return "cancelled";
  if (key.includes("error") || key.includes("erro")) return "error";
  if (key.includes("processing") || key.includes("received") || key.includes("process"))
    return "sent";
  return null;
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!/authorization|cookie|apikey|token|signature|secret/i.test(key)) out[key] = value;
  });
  return out;
}

/** Valida a assinatura configurada na conexão (none | token | hmac_sha256). */
async function validateSignature(
  connection: {
    webhook_secret_name: string | null;
    webhook_signature_header: string;
    webhook_signature_mode: string;
  },
  rawBody: string,
  headers: Headers,
): Promise<{ valid: boolean; reason?: string }> {
  const mode = (connection.webhook_signature_mode || "none").toLowerCase();
  if (mode === "none") return { valid: true };

  const secretName = connection.webhook_secret_name;
  const secret = secretName ? process.env[secretName] : undefined;
  if (!secret) return { valid: false, reason: "Segredo do webhook não configurado no servidor." };

  const headerName = connection.webhook_signature_header || "x-okton-signature";
  const provided = headers.get(headerName)?.trim();
  if (!provided) return { valid: false, reason: `Header ${headerName} ausente.` };

  if (mode === "token") {
    return timingSafeEqual(provided, secret)
      ? { valid: true }
      : { valid: false, reason: "Assinatura inválida." };
  }

  if (mode === "hmac_sha256") {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
    return timingSafeEqual(provided.replace(/^sha256=/i, "").toLowerCase(), digest)
      ? { valid: true }
      : { valid: false, reason: "Assinatura HMAC inválida." };
  }

  return { valid: false, reason: `Modo de assinatura desconhecido: ${mode}` };
}

type Payload = {
  event_id?: string;
  event?: string;
  request_id?: string;
  draft_id?: string;
  document_type?: string;
  status?: string;
  number?: string | number;
  series?: string | number;
  access_key?: string;
  protocol?: string;
  message?: string;
  rejection?: unknown;
  files?: { pdf_url?: string; xml_url?: string } | null;
};

/** Mensagem enviada ao cliente conforme o desfecho informado pela Okton. */
function buildMessage(payload: Payload, label: string) {
  const status = mapStatus(payload.event ?? "", payload.status ?? "");
  const files = payload.files ?? {};
  switch (status) {
    case "authorized":
      return [
        `${label} autorizada com sucesso.`,
        `Número: ${payload.number ?? "-"}`,
        `Série: ${payload.series ?? "-"}`,
        `Chave: ${payload.access_key ?? "-"}`,
        `Protocolo: ${payload.protocol ?? "-"}`,
        "",
        "Arquivos:",
        `• DANFE${files.pdf_url ? `: ${files.pdf_url}` : ""}`,
        `• XML${files.xml_url ? `: ${files.xml_url}` : ""}`,
      ].join("\n");
    case "rejected":
      return `${label} rejeitada.\nMotivo: ${payload.message ?? "não informado pela Okton."}`;

    case "cancelled":
      return `${label} cancelada.\n${payload.message ?? ""}`.trim();
    case "error":
      return `Ocorreu um erro no processamento da ${label}.\n${payload.message ?? ""}`.trim();
    case "sent":
      return `Atualização da ${label}: ${payload.message ?? "documento em processamento."}`;
    default:
      return payload.message ?? `Atualização da ${label} recebida.`;
  }
}

export async function processOktonWebhook(
  rawBody: string,
  headers: Headers,
  options: { skipSignature?: boolean } = {},
): Promise<OktonWebhookOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody || "{}") as Payload;
  } catch {
    return { status: 400, body: { ok: false, error: "Payload inválido" } };
  }

  // 3. Localizar a emissão (pelo protocolo interno ou pelo rascunho).
  const requestId = payload.request_id ?? null;
  let emission: {
    id: string;
    organization_id: string;
    conversation_id: string | null;
    document_type: string;
    draft_id: string | null;
  } | null = null;

  if (requestId) {
    const { data } = await supabaseAdmin
      .from("emissions")
      .select("id,organization_id,conversation_id,document_type,draft_id")
      .eq("protocol", requestId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    emission = data ?? null;
  }
  if (!emission && payload.draft_id) {
    const { data } = await supabaseAdmin
      .from("emissions")
      .select("id,organization_id,conversation_id,document_type,draft_id")
      .eq("draft_id", payload.draft_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    emission = data ?? null;
  }

  // 1. Validar a assinatura contra a conexão ativa da organização.
  const connectionQuery = supabaseAdmin
    .from("api_connections")
    .select(
      "id,organization_id,webhook_secret_name,webhook_signature_header,webhook_signature_mode",
    )
    .eq("active", true);
  const { data: connection } = await (
    emission ? connectionQuery.eq("organization_id", emission.organization_id) : connectionQuery
  )
    .limit(1)
    .maybeSingle();

  if (!connection) return { status: 404, body: { ok: false, error: "Integração não configurada" } };

  const signature = options.skipSignature
    ? { valid: true as const }
    : await validateSignature(connection, rawBody, headers);
  if (!signature.valid) {
    return { status: 401, body: { ok: false, error: signature.reason ?? "Assinatura inválida" } };
  }

  const eventId = payload.event_id ?? null;
  const eventType = payload.event ?? payload.status ?? "document_event";

  // 2. Evitar eventos duplicados.
  if (eventId) {
    const { data: seen } = await supabaseAdmin
      .from("webhook_events")
      .select("id")
      .eq("provider", "okton")
      .eq("external_event_id", eventId)
      .limit(1)
      .maybeSingle();
    if (seen) return { status: 200, body: { ok: true, duplicated: true } };
  }

  // 5. Salvar o evento completo.
  const { data: event } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      organization_id: connection.organization_id,
      provider: "okton",
      event_type: eventType,
      external_event_id: eventId,
      payload_json: payload as never,
      headers_json: safeHeaders(headers) as never,
      processing_status: "pending",
    })
    .select("id")
    .maybeSingle();

  await supabaseAdmin
    .from("api_connections")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", connection.id);

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

  if (!emission) {
    await finish("ignored", "Emissão não localizada para o request_id informado.");
    // 9. Sempre 200 para não gerar reentrega infinita.
    return { status: 200, body: { ok: true, matched: false } };
  }

  // 4. Atualizar o status da emissão.
  const status = mapStatus(eventType, payload.status ?? "");
  const files = payload.files ?? {};

  // ETAPA 17 — rejeição normalizada (mensagem simplificada + técnica).
  const { parseRejection } = await import("@/models/okton-contract");
  const rejection = status === "rejected" ? parseRejection(payload) : null;

  // ETAPA 22 — a IA apenas traduz a rejeição da Okton para linguagem simples.
  // Nenhuma regra fiscal é criada aqui: se a IA falhar, seguimos com o texto original.
  const docLabelForAi = DOC_LABEL[payload.document_type ?? emission.document_type] ?? "documento";
  let aiExplanation: Awaited<
    ReturnType<typeof import("./rejection-ai.server").interpretRejection>
  > = null;
  if (rejection) {
    const { interpretRejection } = await import("./rejection-ai.server");
    aiExplanation = await interpretRejection({
      code: rejection.code,
      friendly_message: rejection.friendly_message,
      technical_message: rejection.technical_message,
      field: rejection.field,
      field_label: rejection.field_label,
      correctable: rejection.correctable,
      document_label: docLabelForAi,
    });
  }

  await supabaseAdmin
    .from("emissions")
    .update({
      ...(status ? { status } : {}),
      access_key: payload.access_key ?? undefined,
      protocol: payload.protocol ?? requestId ?? undefined,
      pdf_url: files.pdf_url ?? undefined,
      xml_url: files.xml_url ?? undefined,
      response_payload: payload as never,
      rejection: rejection
        ? ({
            code: rejection.code,
            friendly_message: rejection.friendly_message,
            technical_message: rejection.technical_message,
            field: rejection.field,
            field_label: rejection.field_label,
            correctable: rejection.correctable,
            ai_explanation: aiExplanation,
            body: payload,
          } as never)
        : status === "error"
          ? ({ message: payload.message ?? null, body: payload } as never)
          : null,
    })
    .eq("id", emission.id);

  const label = DOC_LABEL[payload.document_type ?? emission.document_type] ?? "documento";

  // 6. Encontrar a conversa correspondente.
  if (!emission.conversation_id) {
    await finish("processed", "Emissão sem conversa vinculada.");
    return { status: 200, body: { ok: true, notified: false } };
  }

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id,phone_number,provider,organization_id")
    .eq("id", emission.conversation_id)
    .maybeSingle();

  if (!conversation) {
    await finish("processed", "Conversa não localizada.");
    return { status: 200, body: { ok: true, notified: false } };
  }

  let text = buildMessage(payload, label);

  // ETAPA 17 — mensagem de rejeição com código, problema, campo e menu de ações.
  let rejectionPending = false;
  if (rejection) {
    text = [
      "O documento não foi autorizado.",
      `Código:\n${rejection.code}`,
      `Problema:\n${rejection.friendly_message}`,
      ...(aiExplanation ? [`Em resumo:\n${aiExplanation.explanation}`] : []),
      `Campo relacionado:\n${rejection.field_label ?? "não informado"}`,
      ...(aiExplanation?.next_step ? [`Sugestão:\n${aiExplanation.next_step}`] : []),
      [
        "O que deseja fazer?",
        "1 - Corrigir o campo",
        "2 - Ver o resumo completo",
        "3 - Cancelar a solicitação",
        "4 - Falar com o suporte",
      ].join("\n"),
    ].join("\n\n");

    // Coloca a conversa no menu de rejeição e invalida o token anterior.
    if (emission.draft_id) {
      const { data: draftRow } = await supabaseAdmin
        .from("drafts")
        .select("id,validation_result_json")
        .eq("id", emission.draft_id)
        .maybeSingle();
      if (draftRow) {
        const meta = (draftRow.validation_result_json ?? {}) as Record<string, unknown>;
        await supabaseAdmin
          .from("drafts")
          .update({
            status: "collecting",
            validation_result_json: {
              ...meta,
              pending: "rejection_menu",
              // Nunca reutilizar o token de confirmação anterior.
              confirmation: null,
              rejection: {
                code: rejection.code,
                friendly_message: rejection.friendly_message,
                technical_message: rejection.technical_message,
                field: rejection.field,
                field_label: rejection.field_label,
                correctable: rejection.correctable,
              },
            } as never,
          })
          .eq("id", draftRow.id);
        rejectionPending = true;
      }
    }
  }

  // 8. Registrar o envio.
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversation.id,
    direction: "outbound",
    message_type: "text",
    content: text,
    processing_status: "processed",
    sent_at: new Date().toISOString(),
  });

  // 7. Enviar a mensagem (e os arquivos, quando o provedor permitir).
  const { data: channel } = await supabaseAdmin
    .from("whatsapp_channels")
    .select("*")
    .eq("organization_id", conversation.organization_id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (channel) {
    const provider = new WhatsAppProvider(channel as WhatsAppChannelConfig);
    const sent = await provider.sendTextMessage(conversation.phone_number, text);
    if (!sent.ok) console.warn("[okton-webhook] falha no envio:", sent.error);

    if (status === "authorized" || eventType === "files_available") {
      if (files.pdf_url) {
        await provider.sendDocument(
          conversation.phone_number,
          files.pdf_url,
          `${label}-${payload.number ?? "documento"}.pdf`,
          "DANFE",
        );
      }
      if (files.xml_url) {
        await provider.sendDocument(
          conversation.phone_number,
          files.xml_url,
          `${label}-${payload.number ?? "documento"}.xml`,
          "XML",
        );
      }
    }
  }

  // Em caso de rejeição mantemos a conversa aberta para a correção (ETAPA 17).
  if (
    status === "authorized" ||
    (status === "rejected" && !rejectionPending) ||
    status === "cancelled"
  ) {
    await supabaseAdmin
      .from("conversations")
      .update({ status: "finished", finished_at: new Date().toISOString() })
      .eq("id", conversation.id);
  }

  await finish("processed");
  return { status: 200, body: { ok: true, notified: true, status } };
}
