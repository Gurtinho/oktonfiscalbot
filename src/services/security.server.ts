// ETAPA 20 — Controles de segurança de execução (somente backend).
// Limite de requisições, proteção contra repetição de webhook, idempotência,
// timeout, retentativas controladas e expiração de rascunhos.

export type RateLimitResult = {
  allowed: boolean;
  hits: number;
  limit: number;
  retryAfterSeconds: number;
};

export const RATE_LIMITS = {
  /** Webhook de WhatsApp por canal. */
  whatsapp_webhook: { limit: 120, windowSeconds: 60 },
  /** Webhook fiscal da Okton. */
  okton_webhook: { limit: 120, windowSeconds: 60 },
  /** Mensagens recebidas por telefone. */
  inbound_phone: { limit: 30, windowSeconds: 60 },
  /** Chamadas à Okton por organização. */
  okton_api: { limit: 600, windowSeconds: 60 },
  /** Simulador por usuário do painel. */
  simulator: { limit: 120, windowSeconds: 60 },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/**
 * Registra uma tentativa e informa se o limite da janela foi ultrapassado.
 * Em caso de falha de infraestrutura a requisição é liberada (fail-open) para
 * não derrubar o atendimento, mas o erro é registrado no console do servidor.
 */
export async function checkRateLimit(
  scope: RateLimitScope,
  subject: string,
  organizationId: string | null = null,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[scope];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("register_rate_limit_hit", {
      _scope: scope,
      _subject: subject.slice(0, 120),
      _window_seconds: windowSeconds,
      _organization_id: organizationId ?? undefined,
    });
    if (error) throw error;
    const hits = typeof data === "number" ? data : 1;
    return { allowed: hits <= limit, hits, limit, retryAfterSeconds: windowSeconds };
  } catch (error) {
    console.error("[rate-limit] falha ao registrar tentativa", error);
    return { allowed: true, hits: 0, limit, retryAfterSeconds: windowSeconds };
  }
}

export function rateLimitResponse(result: RateLimitResult) {
  return Response.json(
    { ok: false, error: "Limite de requisições excedido" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

/**
 * Proteção contra repetição (replay) de webhook.
 * Considera duplicado quando o mesmo provedor já registrou o mesmo evento externo.
 */
export async function isWebhookReplay(
  provider: string,
  externalEventId: string | null | undefined,
): Promise<boolean> {
  if (!externalEventId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("webhook_events")
    .select("id")
    .eq("provider", provider)
    .eq("external_event_id", externalEventId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/** Chave de idempotência determinística (SHA-256) para envios à Okton. */
export async function buildIdempotencyKey(
  parts: Array<string | null | undefined>,
): Promise<string> {
  const input = parts.filter(Boolean).join("|");
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

/** Timeout com abort real, usado nas chamadas HTTP externas. */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Retentativas controladas com espera progressiva. */
export async function withRetries<T>(
  operation: (attempt: number) => Promise<T>,
  options: { retries: number; intervalMs: number; shouldRetry?: (result: T) => boolean },
): Promise<T> {
  let last: T | undefined;
  const total = Math.max(0, Math.min(options.retries, 5));
  for (let attempt = 0; attempt <= total; attempt += 1) {
    last = await operation(attempt);
    if (!options.shouldRetry || !options.shouldRetry(last) || attempt === total) return last;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs * (attempt + 1)));
  }
  return last as T;
}

/** Expira rascunhos vencidos (chamada oportunista pelo motor e pelo painel). */
export async function expireStaleDrafts(): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("expire_stale_drafts");
    if (error) throw error;
    return typeof data === "number" ? data : 0;
  } catch (error) {
    console.error("[drafts] falha ao expirar rascunhos", error);
    return 0;
  }
}
