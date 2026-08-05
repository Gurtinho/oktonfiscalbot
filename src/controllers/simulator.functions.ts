// ETAPA 19 — Server functions do simulador.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type { SimulatorSnapshot } from "@/services/simulator.server";

export type SimulatedWebhookKind = "authorized" | "rejected" | "timeout" | "custom";

export const simulatorSendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { organizationId: string; phone: string; text: string }) => data)
  .handler(async ({ data, context }) => {
    const { simulatorSend } = await import("@/services/simulator.server");
    return simulatorSend(data, context.userId);
  });

export const simulatorLoad = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { organizationId: string; phone: string }) => data)
  .handler(async ({ data, context }) => {
    const { loadSnapshotForUser } = await import("@/services/simulator.server");
    return loadSnapshotForUser(context.userId, data.phone);
  });

export const simulatorResetConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { organizationId: string; phone: string }) => data)
  .handler(async ({ data, context }) => {
    const { simulatorReset } = await import("@/services/simulator.server");
    return simulatorReset(data, context.userId);
  });

export const simulatorChangeState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      organizationId: string;
      phone: string;
      status?: string;
      stepId?: string | null;
      botPaused?: boolean;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { simulatorSetState } = await import("@/services/simulator.server");
    return simulatorSetState(data, context.userId);
  });

export const simulatorSendWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      organizationId: string;
      phone: string;
      kind: SimulatedWebhookKind;
      customPayload?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { simulatorWebhook } = await import("@/services/simulator.server");
    return simulatorWebhook(data, context.userId);
  });
