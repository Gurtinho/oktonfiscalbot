// Server functions do banco de testes de API (Okton + WhatsApp).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runOktonApiTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      endpointKey?: string | null;
      method?: string;
      path?: string;
      pathParamsJson?: string;
      queryJson?: string;
      bodyJson?: string;
      headersJson?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { runOktonTest } = await import("@/services/api-tester.server");
    return runOktonTest(data, context.userId);
  });

export const runWhatsAppApiTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      channelId: string;
      phone: string;
      kind: "text" | "options" | "document" | "image";
      text?: string;
      optionsText?: string;
      mediaUrl?: string;
      fileName?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { runWhatsAppTest } = await import("@/services/api-tester.server");
    return runWhatsAppTest(data, context.userId);
  });

export const exportInsomniaCollection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { appOrigin: string }) => data)
  .handler(async ({ data, context }) => {
    const { buildInsomniaCollection } = await import("@/services/api-tester.server");
    const collection = await buildInsomniaCollection(data.appOrigin, context.userId);
    return { json: JSON.stringify(collection, null, 2) };
  });
