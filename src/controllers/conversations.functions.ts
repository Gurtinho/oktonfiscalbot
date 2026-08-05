// ETAPA 18 — Server functions do painel de conversas.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ConversationAction =
  | "pause_bot"
  | "resume_bot"
  | "take_over"
  | "send_manual_message"
  | "return_to_bot"
  | "cancel_conversation"
  | "reprocess_last";

export const conversationAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { conversationId: string; action: ConversationAction; text?: string }) => data,
  )
  .handler(async ({ data, context }) => {
    const { runConversationAction } = await import("@/services/conversation-admin.server");
    return runConversationAction(data, context.userId);
  });
