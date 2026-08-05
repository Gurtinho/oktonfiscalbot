// Webhook público do WhatsApp (URL legada por token). Mantido para canais já
// configurados; a lógica é a mesma do endpoint /api/public/webhooks/whatsapp/{provider}.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { findChannel } = await import("@/services/whatsapp-webhook.server");
        const channel = await findChannel({ token: params.token });
        return channel
          ? Response.json({ ok: true, status: "webhook ativo" })
          : new Response("Canal não encontrado", { status: 404 });
      },
      POST: async ({ request, params }) => {
        const { findChannel, processWhatsAppWebhook } =
          await import("@/services/whatsapp-webhook.server");
        const channel = await findChannel({ token: params.token });
        if (!channel) return new Response("Canal não encontrado", { status: 404 });

        const { checkRateLimit, rateLimitResponse } = await import("@/services/security.server");
        const limit = await checkRateLimit("whatsapp_webhook", channel.id, channel.organization_id);
        if (!limit.allowed) return rateLimitResponse(limit);

        const rawBody = await request.text();
        const outcome = await processWhatsAppWebhook(channel, rawBody, request.headers);
        return Response.json(outcome.body, { status: outcome.status });
      },
    },
  },
});
