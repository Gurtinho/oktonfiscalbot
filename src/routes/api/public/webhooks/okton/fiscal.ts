// ETAPA 16 — POST /api/public/webhooks/okton/fiscal
// Endpoint público de retorno da Okton (assinatura validada no handler).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/webhooks/okton/fiscal")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, endpoint: "okton/fiscal", status: "ativo" }),
      POST: async ({ request }) => {
        const { processOktonWebhook } = await import("@/services/okton-webhook.server");
        const { checkRateLimit, rateLimitResponse } = await import("@/services/security.server");
        const origin = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "okton";
        const limit = await checkRateLimit("okton_webhook", origin);
        if (!limit.allowed) return rateLimitResponse(limit);

        const rawBody = await request.text();
        const outcome = await processOktonWebhook(rawBody, request.headers);
        return Response.json(outcome.body, { status: outcome.status });
      },
    },
  },
});
