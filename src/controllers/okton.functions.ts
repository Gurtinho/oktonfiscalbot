// Server functions do painel. Toda comunicação com a Okton acontece aqui, nunca no browser.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const testOktonConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string; endpointKey?: string }) => data)
  .handler(async ({ data, context }) => {
    const { runConnectionTest } = await import("@/services/okton-admin.server");
    return runConnectionTest(data.connectionId, data.endpointKey, context.userId);
  });

export const callOktonEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      companyId: string | null;
      endpointKey: string;
      body?: unknown;
      query?: Record<string, string>;
      pathParams?: Record<string, string>;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { runEndpointCall } = await import("@/services/okton-admin.server");
    return runEndpointCall(data, context.userId);
  });

export const seedDefaultEndpoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connectionId: string }) => data)
  .handler(async ({ data, context }) => {
    const { createDefaultEndpoints } = await import("@/services/okton-admin.server");
    return createDefaultEndpoints(data.connectionId, context.userId);
  });
