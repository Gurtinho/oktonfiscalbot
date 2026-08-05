// Compatibilidade: o motor de conversa agora vive em conversation-engine.server.ts.
// Este módulo mantém a assinatura antiga usada pelo webhook.
import { ConversationEngine } from "./conversation-engine.server";
import type { WhatsAppChannel } from "./whatsapp.server";

export async function handleInboundMessage(input: {
  channel: WhatsAppChannel & { active?: boolean };
  phone: string;
  name?: string | null;
  text: string;
  messageId?: string | null;
  messageType?: string;
  timestamp?: string;
  raw?: unknown;
}) {
  const organizationId = input.channel.organization_id;
  if (!organizationId) return { ok: false, state: "channel_without_organization" };

  return ConversationEngine.handle({
    organization_id: organizationId,
    phone_number: input.phone,
    external_conversation_id: input.channel.id,
    message_id: input.messageId ?? null,
    message_type: input.messageType ?? "text",
    message_content: input.text,
    timestamp: input.timestamp,
    channel: input.channel,
  });
}
