// POST /api/public/webhooks/whatsapp/{provider}
// Endpoint agnóstico de fornecedor: o provedor vem da URL e o canal é
// resolvido pelo token de webhook (query ?token= ou header x-webhook-token).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/whatsapp/$provider")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { findChannel } = await import("@/services/whatsapp-webhook.server");
        const channel = await findChannel({ provider: params.provider });
        return channel
          ? Response.json({ ok: true, provider: params.provider, status: "webhook ativo" })
          : new Response("Provedor não configurado", { status: 404 });
      },
      POST: async ({ request, params }) => {
        const { findChannel, processWhatsAppWebhook } =
          await import("@/services/whatsapp-webhook.server");
        const url = new URL(request.url);
        const token =
          url.searchParams.get("token") ?? request.headers.get("x-webhook-token") ?? null;
        const channel = await findChannel({ provider: params.provider, token });
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
