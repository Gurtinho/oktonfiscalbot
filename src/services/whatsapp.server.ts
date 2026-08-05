// Compatibilidade: delega tudo para a camada WhatsAppProvider (ETAPA 8).
import { WhatsAppProvider, type WhatsAppChannelConfig } from "./whatsapp-provider.server";

export type WhatsAppChannel = WhatsAppChannelConfig;

export async function sendWhatsAppMessage(
  channel: WhatsAppChannel,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await new WhatsAppProvider(channel).sendTextMessage(phone, text);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export function parseInboundMessage(payload: Record<string, unknown>) {
  return WhatsAppProvider.parseIncomingWebhook(payload);
}
