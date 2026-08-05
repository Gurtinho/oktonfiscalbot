// ETAPA 18 — Ações manuais do painel de conversas. Toda ação gera auditoria.
import { sendWhatsAppMessage } from "./whatsapp.server";
import type { WhatsAppChannelConfig } from "./whatsapp-provider.server";

import type { ConversationAction } from "@/controllers/conversations.functions";
export type { ConversationAction };

export type ActionResult = {
  ok: boolean;
  message: string;
  state?: string;
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
  return data ?? null;
}

async function audit(opts: {
  organizationId: string | null;
  appUserId: string | null;
  action: string;
  entityId: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}) {
  const supabase = await admin();
  const { error } = await supabase.from("audit_logs").insert({
    organization_id: opts.organizationId,
    app_user_id: opts.appUserId,
    action: opts.action,
    entity_type: "conversation",
    entity_id: opts.entityId,
    old_data_json: (opts.oldData ?? {}) as never,
    new_data_json: (opts.newData ?? {}) as never,
  });
  if (error) console.error("[conversation-admin] falha ao registrar auditoria:", error.message);
}

async function loadChannel(organizationId: string) {
  const supabase = await admin();
  const { data } = await supabase
    .from("whatsapp_channels")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data as WhatsAppChannelConfig | null) ?? null;
}

export async function runConversationAction(
  input: { conversationId: string; action: ConversationAction; text?: string },
  authUserId: string,
): Promise<ActionResult> {
  const supabase = await admin();
  const me = await actor(authUserId);
  if (!me || me.status !== "active") return { ok: false, message: "Usuário sem acesso ativo." };

  const { data: conversation } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", input.conversationId)
    .eq("organization_id", me.organization_id)
    .maybeSingle();

  if (!conversation) return { ok: false, message: "Conversa não encontrada." };

  const before = {
    status: conversation.status,
    bot_paused: (conversation as { bot_paused?: boolean }).bot_paused ?? false,
    assigned_app_user_id:
      (conversation as { assigned_app_user_id?: string | null }).assigned_app_user_id ?? null,
  };

  const apply = async (patch: Record<string, unknown>, message: string) => {
    const { error } = await supabase
      .from("conversations")
      .update({ ...patch, last_interaction_at: new Date().toISOString() })
      .eq("id", conversation.id);
    if (error) return { ok: false, message: error.message };
    await audit({
      organizationId: me.organization_id,
      appUserId: me.id,
      action: input.action,
      entityId: conversation.id,
      oldData: before,
      newData: patch,
    });
    return { ok: true, message };
  };

  switch (input.action) {
    case "pause_bot":
      return apply({ bot_paused: true }, "Bot pausado nesta conversa.");

    case "resume_bot":
      return apply({ bot_paused: false }, "Bot retomado.");

    case "take_over":
      return apply(
        { bot_paused: true, status: "human", assigned_app_user_id: me.id },
        `Atendimento assumido por ${me.name}.`,
      );

    case "return_to_bot":
      return apply(
        { bot_paused: false, status: "active", assigned_app_user_id: null },
        "Conversa devolvida ao bot.",
      );

    case "cancel_conversation":
      return apply(
        {
          bot_paused: false,
          status: "cancelled",
          finished_at: new Date().toISOString(),
          assigned_app_user_id: null,
        },
        "Conversa cancelada.",
      );

    case "send_manual_message": {
      const text = (input.text ?? "").trim();
      if (!text) return { ok: false, message: "Mensagem vazia." };

      const channel = await loadChannel(me.organization_id);
      let delivery = "sem canal ativo";
      if (channel) {
        const result = await sendWhatsAppMessage(channel, conversation.phone_number, text);
        delivery = result.ok ? "enviada" : `falha: ${result.error ?? "erro desconhecido"}`;
        if (!result.ok) {
          await supabase
            .from("conversations")
            .update({
              last_error: result.error ?? "Falha no envio manual",
              last_error_at: new Date().toISOString(),
            })
            .eq("id", conversation.id);
        }
      }

      await supabase.from("messages").insert({
        conversation_id: conversation.id,
        direction: "outbound",
        message_type: "text",
        content: text,
        processing_status: channel ? "processed" : "failed",
        sent_at: new Date().toISOString(),
      });

      await audit({
        organizationId: me.organization_id,
        appUserId: me.id,
        action: "send_manual_message",
        entityId: conversation.id,
        oldData: before,
        newData: { content: text, delivery },
      });

      return { ok: channel != null, message: `Mensagem manual ${delivery}.` };
    }

    case "reprocess_last": {
      const { data: last } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .eq("direction", "inbound")
        .order("received_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (!last?.content)
        return { ok: false, message: "Nenhuma mensagem do cliente para reprocessar." };

      const { processInboundMessage } = await import("./conversation-engine.server");
      const result = await processInboundMessage({
        organization_id: me.organization_id,
        phone_number: conversation.phone_number,
        external_conversation_id: conversation.external_conversation_id,
        message_content: last.content,
        message_type: last.message_type ?? "text",
      });

      await audit({
        organizationId: me.organization_id,
        appUserId: me.id,
        action: "reprocess_last",
        entityId: conversation.id,
        oldData: before,
        newData: { reprocessed_content: last.content, state: result.state },
      });

      return { ok: result.ok, message: `Reprocessado (${result.state}).`, state: result.state };
    }

    default:
      return { ok: false, message: "Ação desconhecida." };
  }
}
