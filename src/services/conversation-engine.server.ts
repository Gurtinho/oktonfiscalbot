// ConversationEngine — motor de conversa do Okton Fiscal Bot.
//
// Regras invioláveis:
// - Nenhum cálculo tributário, numeração ou XML é gerado aqui.
// - Nenhuma decisão fiscal é tomada por IA: validação e emissão sempre vêm da Okton.
// - O roteiro é lido de flow_definitions / flow_steps (configurável no painel).
import { sendWhatsAppMessage, type WhatsAppChannel } from "./whatsapp.server";
import { logAudit } from "./okton.server";
import type { IdentifyCompanyResult, OktonSummary } from "@/models/okton-contract";
import {
  buildFieldPrompt,
  describeValue,
  prepareFieldValue,
  resolvedSummary,
  shouldConfirmField,
  type CollectField,
} from "@/models/field-collection";

export type Json = Record<string, unknown>;

export type ConversationEngineInput = {
  organization_id: string;
  phone_number: string;
  external_conversation_id?: string | null;
  message_id?: string | null;
  message_type?: string;
  message_content: string;
  timestamp?: string;
  channel?: WhatsAppChannel | null;
  /** ETAPA 19 — execução pelo simulador: mesmo motor, sem entrega externa. */
  simulate?: boolean;
};

export type ConversationEngineResult = {
  ok: boolean;
  state: string;
  conversation_id?: string;
  step_key?: string | null;
  messages?: string[];
};

const ONLY_DIGITS = /[^0-9]/g;
const OPEN_DRAFT_STATUS = ["collecting", "validating", "awaiting_confirmation"] as const;

const DOC_LABEL: Record<string, string> = { nfe: "NF-e", cte: "CT-e", mdfe: "MDF-e" };
/** ETAPA 14 — validade padrão do código de confirmação quando a Okton não informa. */
const CONFIRMATION_TTL_SECONDS = 600;

/** ETAPA 9 — textos oficiais da identificação por CNPJ. */
const GREETING =
  "Olá! Sou o assistente fiscal da Okton.\n\nPara começar, informe o CNPJ da empresa.";

const COMPANY_NOT_FOUND_MENU =
  "Não encontrei este CNPJ na Okton.\n\nVerifique o número informado ou entre em contato com o suporte para realizar o cadastro.\n\n1 - Tentar novamente\n2 - Falar com o suporte\n3 - Encerrar";

/** Validação apenas de formato: nenhuma consulta a base externa. */
function isCnpjFormatValid(digits: string) {
  return digits.length === 14 && !/^(\d)\1{13}$/.test(digits);
}

function formatCnpj(digits: string) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function normalize(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Lista de documentos autorizados conforme resposta da Okton. */
function parseAllowedDocuments(data: unknown): string[] {
  const root =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const raw = Array.isArray(data)
    ? data
    : ((root?.allowed_documents ??
        root?.documentos_permitidos ??
        root?.documents ??
        root?.documentos ??
        root?.data ??
        []) as unknown);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      const entry = item as Record<string, unknown>;
      const value = entry?.type ?? entry?.tipo ?? entry?.code ?? entry?.codigo ?? entry?.value;
      return typeof value === "string" ? value : "";
    })
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const WAITING_STEPS = new Set([
  "collect_value",
  "select_option",
  "identify_company",
  "select_branch",
  "select_document",
  "select_input_mode",
  "collect_dynamic_fields",
  "request_confirmation",
]);

export type GlobalCommand =
  "menu" | "voltar" | "corrigir" | "resumo" | "cancelar" | "atendente" | "sair";

const COMMAND_ALIASES: Record<string, GlobalCommand> = {
  menu: "menu",
  inicio: "menu",
  reiniciar: "menu",
  voltar: "voltar",
  anterior: "voltar",
  corrigir: "corrigir",
  editar: "corrigir",
  alterar: "corrigir",
  resumo: "resumo",
  revisar: "resumo",
  cancelar: "cancelar",
  atendente: "atendente",
  humano: "atendente",
  suporte: "atendente",
  sair: "sair",
  encerrar: "sair",
};

export function parseGlobalCommand(text: string): GlobalCommand | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return COMMAND_ALIASES[normalized] ?? null;
}

function setByPath(target: Json, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor: Json = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Json;
  }
  cursor[parts[parts.length - 1]] = value;
  return target;
}

function getByPath(source: Json, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      source,
    );
}

function unsetByPath(target: Json, path: string) {
  const parts = path.split(".");
  let cursor: Json = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = cursor[parts[i]];
    if (!next || typeof next !== "object") return target;
    cursor = next as Json;
  }
  delete cursor[parts[parts.length - 1]];
  return target;
}

function coerce(inputType: string, raw: string): unknown {
  const value = raw.trim();
  switch (inputType) {
    case "number":
    case "decimal":
      return Number(value.replace(/\./g, "").replace(",", "."));
    case "boolean":
      return /^(sim|s|1|true|yes)$/i.test(value);
    case "cnpj":
    case "cpf":
    case "document":
      return value.replace(ONLY_DIGITS, "");
    default:
      return value;
  }
}

/** Validação apenas de formato/preenchimento. Regra fiscal é exclusividade da Okton. */
function validateLocalFormat(
  rules: { input_type: string; required: boolean; validation: Json | null },
  value: unknown,
): string | null {
  if (rules.required && (value === "" || value === null || value === undefined)) {
    return "Este campo é obrigatório.";
  }
  if ((rules.input_type === "number" || rules.input_type === "decimal") && Number.isNaN(value)) {
    return "Informe um número válido.";
  }
  if (rules.input_type === "cnpj" && String(value).length !== 14) {
    return "O CNPJ deve conter 14 dígitos.";
  }
  const extra = (rules.validation ?? {}) as {
    minLength?: number;
    maxLength?: number;
    regex?: string;
  };
  const asText = String(value ?? "");
  if (extra.minLength && asText.length < extra.minLength)
    return `Mínimo de ${extra.minLength} caracteres.`;
  if (extra.maxLength && asText.length > extra.maxLength)
    return `Máximo de ${extra.maxLength} caracteres.`;
  if (extra.regex && !new RegExp(extra.regex).test(asText)) return "Formato inválido.";
  return null;
}

function renderTemplate(template: string, data: Json): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, path: string) => {
    const value = getByPath(data, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

type StepRow = {
  id: string;
  flow_id: string;
  key: string;
  name: string;
  step_type: string;
  message_template: string;
  field_key: string | null;
  order: number;
  next_step_id: string | null;
  error_step_id: string | null;
  configuration_json: Json | null;
  active: boolean;
};

type StepConfig = {
  input_type?: string;
  required?: boolean;
  validation?: Json;
  options?: Array<{ value: string; label: string } | string>;
  validate_with_okton?: boolean;
  source?: string;
};

type DraftMeta = {
  history?: string[];
  pending?:
    | "cancel_confirm"
    | "correct_select"
    | "field_confirm"
    | "field_error"
    | "emitting"
    | "rejection_menu"
    | null;
  /** ETAPA 17 — rejeição devolvida pela Okton, aguardando decisão do usuário. */
  rejection?: {
    code: string;
    friendly_message: string;
    technical_message?: string;
    field?: string | null;
    field_label?: string | null;
    correctable?: boolean;
  } | null;
  correct_options?: string[];
  last_field?: string | null;
  branches?: Array<{ id: string; name: string }>;
  /** ETAPA 11 — catálogo completo dos campos retornados pela Okton. */
  required_fields?: CollectField[];
  /** Índice do campo que está sendo coletado no modo campo por campo. */
  field_index?: number;
  /** Valor aguardando confirmação do usuário. */
  pending_field?: {
    key: string;
    value?: unknown;
    resolved?: Record<string, unknown>;
  } | null;
  /** ETAPA 12 — modo escolhido em select_input_mode. */
  input_mode?: "bulk" | "guided" | "existing_draft" | null;
  /** ETAPA 12 — no modo em bloco: aguardando o texto ou corrigindo pendências. */
  bulk_stage?: "awaiting_text" | "correcting" | null;
  /** ETAPA 12 — fila de campos a coletar (apenas os pendentes, quando definida). */
  queue?: string[] | null;
  /** ETAPA 14 — token de confirmação devolvido pela Okton (com expiração). */
  confirmation?: {
    token: string;
    expires_at: string;
    okton_draft_id?: string | null;
    confirmed_at?: string;
  } | null;
};

export class ConversationEngine {
  private supabase!: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"];
  private channel: WhatsAppChannel | null = null;
  private sent: string[] = [];
  private identifyCache: {
    cnpj: string;
    result: Extract<IdentifyCompanyResult, { found: true }> | null;
  } | null = null;
  private allowedDocsCache: string[] | null = null;

  private constructor(private readonly input: ConversationEngineInput) {}

  static async handle(input: ConversationEngineInput): Promise<ConversationEngineResult> {
    const engine = new ConversationEngine(input);
    return engine.run();
  }

  // -------------------------------------------------------------------------
  // Infra
  // -------------------------------------------------------------------------

  private async reply(conversationId: string, message: string) {
    if (!message) return;
    this.sent.push(message);
    await this.supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "outbound",
      message_type: "text",
      content: message,
      processing_status: "processed",
      sent_at: new Date().toISOString(),
    });
    if (this.channel) {
      const result = await sendWhatsAppMessage(this.channel, this.input.phone_number, message);
      if (!result.ok) console.warn("[engine] falha no envio:", result.error);
    }
  }

  private async loadChannel() {
    if (this.input.simulate) {
      this.channel = null;
      return;
    }
    if (this.input.channel) {
      this.channel = this.input.channel;
      return;
    }
    const { data } = await this.supabase
      .from("whatsapp_channels")
      .select("*")
      .eq("organization_id", this.input.organization_id)
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    this.channel = (data as WhatsAppChannel | null) ?? null;
  }

  private async getDraft(conversationId: string) {
    const { data } = await this.supabase
      .from("drafts")
      .select("*")
      .eq("conversation_id", conversationId)
      .in("status", [...OPEN_DRAFT_STATUS])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  private meta(draft: { validation_result_json: unknown } | null): DraftMeta {
    return ((draft?.validation_result_json ?? {}) as DraftMeta) || {};
  }

  private async saveMeta(draftId: string, meta: DraftMeta) {
    await this.supabase
      .from("drafts")
      .update({ validation_result_json: meta as never })
      .eq("id", draftId);
  }

  private async getStep(id: string | null | undefined): Promise<StepRow | null> {
    if (!id) return null;
    const { data } = await this.supabase.from("flow_steps").select("*").eq("id", id).maybeSingle();
    return (data as StepRow | null) ?? null;
  }

  private async nextStepOf(step: StepRow): Promise<StepRow | null> {
    if (step.next_step_id) {
      const explicit = await this.getStep(step.next_step_id);
      if (explicit?.active) return explicit;
      if (explicit) return this.nextStepOf(explicit);
      return null;
    }
    const { data } = await this.supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", step.flow_id)
      .eq("active", true)
      .gt("order", step.order)
      .order("order")
      .limit(1)
      .maybeSingle();
    return (data as StepRow | null) ?? null;
  }

  // -------------------------------------------------------------------------
  // Execução principal
  // -------------------------------------------------------------------------

  private async run(): Promise<ConversationEngineResult> {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    this.supabase = supabaseAdmin;
    await this.loadChannel();

    const organizationId = this.input.organization_id;
    if (!organizationId) return { ok: false, state: "missing_organization" };

    // 1. encontrar ou criar a conversa
    const conversation = await this.findOrCreateConversation();
    const conversationId = conversation.id;

    // 4. salvar a mensagem recebida
    await this.supabase.from("messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      message_type: this.input.message_type ?? "text",
      content: this.input.message_content,
      external_message_id: this.input.message_id ?? null,
      processing_status: "processed",
      received_at: this.input.timestamp ?? new Date().toISOString(),
    });
    await this.supabase
      .from("conversations")
      .update({ last_interaction_at: new Date().toISOString() })
      .eq("id", conversationId);

    // ETAPA 18 — bot pausado/atendimento humano: apenas registra a mensagem.
    if ((conversation as { bot_paused?: boolean }).bot_paused) {
      return {
        ok: true,
        state: "bot_paused",
        conversation_id: conversationId,
      } as ConversationEngineResult;
    }

    const text = (this.input.message_content ?? "").trim();
    const draft = await this.getDraft(conversationId);

    // Confirmações pendentes têm prioridade sobre qualquer outra interpretação.
    const pendingResult = await this.handlePending(conversation, draft, text);
    if (pendingResult) return this.finish(pendingResult, conversationId);

    // Comandos globais
    const command = parseGlobalCommand(text);
    if (command) {
      const result = await this.handleGlobalCommand(command, conversation, draft);
      return this.finish(result, conversationId);
    }

    // 2/3. etapa atual e interpretação da resposta (ETAPA 9 — identificação por CNPJ)
    if (conversation.status === "awaiting_cnpj") {
      return this.finish(await this.handleCnpj(conversation, text), conversationId);
    }

    if (conversation.status === "confirming_company") {
      return this.finish(await this.handleCompanyConfirm(conversation, text), conversationId);
    }

    if (conversation.status === "company_not_found") {
      return this.finish(await this.handleCompanyNotFound(conversation, text), conversationId);
    }

    if (conversation.status === "selecting_branch") {
      return this.finish(await this.handleBranchSelection(conversation, text), conversationId);
    }

    if (conversation.status === "choosing_flow" || !conversation.current_flow_id) {
      return this.finish(await this.chooseFlow(conversation, text), conversationId);
    }

    if (conversation.status === "human") {
      return this.finish({ ok: true, state: "human_handoff" }, conversationId);
    }

    const step = await this.getStep(conversation.current_step_id);
    if (!step) {
      await this.reply(conversationId, "Não encontrei a etapa atual. Envie *MENU* para recomeçar.");
      return this.finish({ ok: true, state: "step_missing" }, conversationId);
    }

    const currentDraft = draft ?? (await this.getDraft(conversationId));
    if (!currentDraft) {
      await this.supabase
        .from("conversations")
        .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
        .eq("id", conversationId);
      await this.reply(conversationId, "Rascunho não encontrado. Envie *MENU* para recomeçar.");
      return this.finish({ ok: true, state: "draft_missing" }, conversationId);
    }

    const applied = await this.applyAnswer(conversation, currentDraft, step, text);
    if (applied.ok && applied.halt) return this.finish(applied.halt, conversationId);
    if (!applied.ok) {
      // 7. comportamento de erro configurado na etapa
      const errorStep = await this.getStep(step.error_step_id);
      if (errorStep) {
        await this.reply(conversationId, applied.message ?? "Não consegui validar sua resposta.");
        return this.finish(await this.runFrom(conversation, errorStep), conversationId);
      }
      await this.reply(
        conversationId,
        `${applied.message ?? "Resposta inválida."}\n\n${renderTemplate(
          step.message_template,
          (currentDraft.current_data_json as Json) ?? {},
        )}`,
      );
      return this.finish({ ok: true, state: "invalid_input", step_key: step.key }, conversationId);
    }

    // 7/8/9. próxima etapa, mensagem e envio
    const next = await this.nextStepOf(step);
    if (!next) {
      await this.reply(conversationId, "Fluxo concluído.");
      await this.supabase
        .from("conversations")
        .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
        .eq("id", conversationId);
      return this.finish({ ok: true, state: "flow_completed" }, conversationId);
    }
    return this.finish(await this.runFrom(conversation, next), conversationId);
  }

  private finish(result: ConversationEngineResult, conversationId: string) {
    // 10. salvar o resultado
    return { ...result, conversation_id: conversationId, messages: this.sent };
  }

  private async findOrCreateConversation() {
    const { data: existing } = await this.supabase
      .from("conversations")
      .select("*")
      .eq("organization_id", this.input.organization_id)
      .eq("phone_number", this.input.phone_number)
      .neq("status", "finished")
      .order("last_interaction_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;

    const { data: created, error } = await this.supabase
      .from("conversations")
      .insert({
        organization_id: this.input.organization_id,
        provider: this.channel?.provider ?? "whatsapp",
        external_conversation_id:
          this.input.external_conversation_id ?? this.channel?.id ?? this.input.phone_number,
        phone_number: this.input.phone_number,
        status: "awaiting_cnpj",
      })
      .select("*")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Falha ao criar conversa");
    return created;
  }

  // -------------------------------------------------------------------------
  // Comandos globais
  // -------------------------------------------------------------------------

  private async handlePending(
    conversation: {
      id: string;
      status: string;
      current_step_id: string | null;
      okton_company_id?: string | null;
      okton_branch_id?: string | null;
    },
    draft: {
      id: string;
      document_type?: string;
      validation_result_json: unknown;
      current_data_json: unknown;
    } | null,
    text: string,
  ): Promise<ConversationEngineResult | null> {
    if (!draft) return null;
    const meta = this.meta(draft);

    // ETAPA 11 — confirmação do dado resolvido pela Okton.
    if (meta.pending === "field_confirm") {
      const { field, index } = this.currentField(meta);
      const pendingField = meta.pending_field;
      if (!field || !pendingField) {
        await this.saveMeta(draft.id, { ...meta, pending: null, pending_field: null });
        return null;
      }
      const answer = text.trim();
      if (/^(1|sim|s|ok|confirmo|confirmar)$/i.test(answer)) {
        const halt = await this.commitField(
          conversation.id,
          draft,
          { ...meta, pending: null, pending_field: null },
          index,
          field,
          pendingField.value,
          pendingField.resolved ?? {},
        );
        return halt ?? (await this.continueAfterFields(conversation));
      }
      if (/^(2|nao|não|n)$/i.test(answer)) {
        await this.saveMeta(draft.id, { ...meta, pending: null, pending_field: null });
        await this.reply(conversation.id, buildFieldPrompt(field));
        return { ok: true, state: "field_retry", step_key: field.key };
      }
      await this.reply(conversation.id, "Responda 1 - Sim ou 2 - Não.");
      return { ok: true, state: "field_confirming", step_key: field.key };
    }

    // ETAPA 11 — menu apresentado quando a Okton recusa o valor.
    if (meta.pending === "field_error") {
      const { field, index } = this.currentField(meta);
      if (!field) {
        await this.saveMeta(draft.id, { ...meta, pending: null, pending_field: null });
        return null;
      }
      const answer = text.trim();
      if (/^(1|tentar|tentar novamente)$/i.test(answer)) {
        await this.saveMeta(draft.id, { ...meta, pending: null, pending_field: null });
        await this.reply(conversation.id, buildFieldPrompt(field));
        return { ok: true, state: "field_retry", step_key: field.key };
      }
      if (/^(2|voltar)$/i.test(answer)) {
        const previousIndex = Math.max(0, index - 1);
        const previous = (meta.required_fields ?? [])[previousIndex] ?? field;
        await this.saveMeta(draft.id, {
          ...meta,
          pending: null,
          pending_field: null,
          field_index: previousIndex,
        });
        await this.reply(conversation.id, buildFieldPrompt(previous));
        return { ok: true, state: "field_back", step_key: previous.key };
      }
      if (/^(3|suporte|atendente)$/i.test(answer)) {
        await this.saveMeta(draft.id, { ...meta, pending: null, pending_field: null });
        await this.supabase
          .from("conversations")
          .update({ status: "human" })
          .eq("id", conversation.id);
        await this.reply(
          conversation.id,
          "Certo! Vou transferir este atendimento para um de nossos especialistas.",
        );
        return { ok: true, state: "human_handoff" };
      }
      await this.reply(
        conversation.id,
        "Responda 1 - Tentar novamente, 2 - Voltar ou 3 - Falar com o suporte.",
      );
      return { ok: true, state: "field_error_menu", step_key: field.key };
    }

    // ETAPA 17 — menu apresentado após uma rejeição da Okton.
    if (meta.pending === "rejection_menu") {
      return this.handleRejectionMenu(conversation, draft, meta, text);
    }

    if (meta.pending === "cancel_confirm") {
      const yes = /^(sim|s|1|confirmar|confirmo)$/i.test(text.trim());
      await this.saveMeta(draft.id, { ...meta, pending: null });
      if (!yes) {
        await this.reply(
          conversation.id,
          "Cancelamento abortado. Vamos continuar de onde paramos.",
        );
        const step = await this.getStep(conversation.current_step_id);
        if (step) await this.reply(conversation.id, this.renderStep(step, draft));
        return { ok: true, state: "cancel_aborted" };
      }
      await this.supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id);
      await this.supabase
        .from("conversations")
        .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
        .eq("id", conversation.id);
      await this.reply(
        conversation.id,
        "Atendimento cancelado. Envie *MENU* para começar de novo.",
      );
      return { ok: true, state: "cancelled" };
    }

    if (meta.pending === "correct_select") {
      const options = meta.correct_options ?? [];
      const index = Number(text.trim());
      const chosen =
        Number.isInteger(index) && index >= 1 && index <= options.length
          ? options[index - 1]
          : options.find((field) => field.toLowerCase() === text.trim().toLowerCase());
      if (!chosen) {
        await this.reply(
          conversation.id,
          "Não entendi. Responda com o número do campo a corrigir.",
        );
        return { ok: true, state: "correct_waiting" };
      }
      const data = unsetByPath({ ...((draft.current_data_json as Json) ?? {}) }, chosen);
      await this.supabase
        .from("drafts")
        .update({ current_data_json: data as never })
        .eq("id", draft.id);
      await this.saveMeta(draft.id, { ...meta, pending: null, correct_options: [] });

      const target = await this.findStepByField(conversation.current_step_id, chosen);
      if (!target) {
        await this.reply(conversation.id, `Campo *${chosen}* limpo. Informe o novo valor.`);
        return { ok: true, state: "correct_no_step" };
      }
      await this.supabase
        .from("conversations")
        .update({ current_step_id: target.id })
        .eq("id", conversation.id);
      await this.reply(conversation.id, this.renderStep(target, draft));
      return { ok: true, state: "correcting", step_key: target.key };
    }

    return null;
  }

  private renderStep(step: StepRow, draft: { current_data_json: unknown } | null): string {
    return renderTemplate(
      step.message_template,
      ((draft?.current_data_json as Json) ?? {}) as Json,
    );
  }

  private async findStepByField(currentStepId: string | null, field: string) {
    const current = await this.getStep(currentStepId);
    if (!current) return null;
    const { data } = await this.supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", current.flow_id)
      .eq("field_key", field)
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    return (data as StepRow | null) ?? null;
  }

  private async findStepByType(currentStepId: string | null, type: StepRow["step_type"]) {
    const current = await this.getStep(currentStepId);
    if (!current) return null;
    const { data } = await this.supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", current.flow_id)
      .eq("step_type", type as never)
      .eq("active", true)
      .order("order")
      .limit(1)
      .maybeSingle();
    return (data as StepRow | null) ?? null;
  }

  private rejectionMenu() {
    return [
      "O que deseja fazer?",
      "1 - Corrigir o campo",
      "2 - Ver o resumo completo",
      "3 - Cancelar a solicitação",
      "4 - Falar com o suporte",
    ].join("\n");
  }

  /**
   * ETAPA 17 — tratamento das rejeições.
   * A mensagem simplificada vem da Okton; a técnica fica apenas no painel.
   */
  private async handleRejectionMenu(
    conversation: { id: string; current_step_id: string | null },
    draft: {
      id: string;
      document_type?: string;
      current_data_json: unknown;
      validation_result_json: unknown;
    },
    meta: DraftMeta,
    text: string,
  ): Promise<ConversationEngineResult> {
    const answer = text.trim();
    const rejection = meta.rejection ?? null;

    // 1 - Corrigir o campo indicado pela Okton.
    if (/^(1|corrigir)$/i.test(answer)) {
      const fieldKey = rejection?.field ?? null;
      const fields = meta.required_fields ?? [];
      const field = fieldKey ? (fields.find((item) => item.key === fieldKey) ?? null) : null;

      if (!fieldKey) {
        // Sem campo indicado: usa o seletor genérico de correção.
        const options = this.flatFields((draft.current_data_json as Json) ?? {}).map(
          (item) => item.path,
        );
        if (options.length === 0) {
          await this.reply(
            conversation.id,
            `A Okton não indicou um campo corrigível.\n\n${this.rejectionMenu()}`,
          );
          return { ok: true, state: "rejection_menu" };
        }
        await this.saveMeta(draft.id, {
          ...meta,
          pending: "correct_select",
          correct_options: options,
        });
        await this.reply(
          conversation.id,
          `Qual informação deseja corrigir?\n${options
            .map((item, index) => `${index + 1} - ${item}`)
            .join("\n")}`,
        );
        return { ok: true, state: "rejection_correct_select" };
      }

      // 1/2. Retorna a conversa para o campo e limpa o valor anterior.
      const data = unsetByPath({ ...((draft.current_data_json as Json) ?? {}) }, fieldKey);
      await this.supabase
        .from("drafts")
        .update({ current_data_json: data as never, status: "collecting" })
        .eq("id", draft.id);

      await this.saveMeta(draft.id, {
        ...meta,
        pending: null,
        pending_field: null,
        rejection: null,
        input_mode: "guided",
        bulk_stage: null,
        // Apenas o campo rejeitado será recoletado.
        queue: [fieldKey],
        field_index: 0,
        // Nunca reutilizar o token de confirmação anterior.
        confirmation: null,
      });

      // A conversa volta para a etapa de coleta dinâmica do fluxo.
      const collectStep = await this.findStepByType(
        conversation.current_step_id,
        "collect_dynamic_fields",
      );
      if (collectStep) {
        await this.supabase
          .from("conversations")
          .update({ current_step_id: collectStep.id, status: "active" })
          .eq("id", conversation.id);
      }

      await this.reply(
        conversation.id,
        field
          ? buildFieldPrompt(field)
          : `Informe o novo valor para *${rejection?.field_label ?? fieldKey}*.`,
      );
      return { ok: true, state: "rejection_correcting", step_key: fieldKey };
    }

    // 2 - Ver o resumo completo (revalidação na Okton, com novo token).
    if (/^(2|resumo)$/i.test(answer)) {
      const fresh = await this.getDraft(conversation.id);
      const target = fresh ?? draft;
      const result = await this.sendFinalSummary(conversation.id, {
        id: target.id,
        document_type: (target as { document_type?: string }).document_type ?? "",
        current_data_json: target.current_data_json,
        validation_result_json: target.validation_result_json,
        okton_draft_id: (target as { okton_draft_id?: string | null }).okton_draft_id ?? null,
      });
      if (!result.ok) {
        await this.saveMeta(target.id, { ...this.meta(target), pending: "rejection_menu" });
        return { ok: true, state: result.state };
      }
      return { ok: true, state: "rejection_summary" };
    }

    // 3 - Cancelar a solicitação.
    if (/^(3|cancelar)$/i.test(answer)) {
      await this.supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id);
      await this.supabase
        .from("conversations")
        .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
        .eq("id", conversation.id);
      await this.reply(
        conversation.id,
        "Solicitação cancelada. Envie *MENU* para começar novamente.",
      );
      return { ok: true, state: "rejection_cancelled" };
    }

    // 4 - Falar com o suporte.
    if (/^(4|suporte|atendente)$/i.test(answer)) {
      await this.saveMeta(draft.id, { ...meta, pending: null });
      await this.supabase
        .from("conversations")
        .update({ status: "human" })
        .eq("id", conversation.id);
      await this.reply(
        conversation.id,
        "Certo! Vou transferir este atendimento para um de nossos especialistas.",
      );
      return { ok: true, state: "human_handoff" };
    }

    await this.reply(conversation.id, `Não entendi.\n\n${this.rejectionMenu()}`);
    return { ok: true, state: "rejection_menu" };
  }

  private async handleGlobalCommand(
    command: GlobalCommand,
    conversation: {
      id: string;
      status: string;
      company_cnpj: string | null;
      current_step_id: string | null;
    },
    draft: { id: string; current_data_json: unknown; validation_result_json: unknown } | null,
  ): Promise<ConversationEngineResult> {
    const conversationId = conversation.id;

    switch (command) {
      case "menu": {
        if (draft)
          await this.supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id);
        await this.supabase
          .from("conversations")
          .update({
            status: conversation.company_cnpj ? "choosing_flow" : "awaiting_cnpj",
            current_flow_id: null,
            current_step_id: null,
          })
          .eq("id", conversationId);
        if (!conversation.company_cnpj) {
          await this.reply(conversationId, "Informe o CNPJ da empresa emitente (somente números).");
          return { ok: true, state: "menu" };
        }
        return this.sendFlowMenu(conversationId, conversation.company_cnpj);
      }

      case "voltar": {
        if (!draft) {
          await this.reply(conversationId, "Não há etapa anterior. Envie *MENU* para recomeçar.");
          return { ok: true, state: "back_unavailable" };
        }
        const meta = this.meta(draft);
        const history = [...(meta.history ?? [])];
        history.pop(); // etapa atual
        const previousId = history.pop();
        const previous = await this.getStep(previousId ?? null);
        if (!previous) {
          await this.reply(conversationId, "Você já está na primeira etapa.");
          return { ok: true, state: "back_first_step" };
        }
        // VOLTAR não apaga o rascunho: apenas o campo da etapa retomada é liberado.
        const data = previous.field_key
          ? unsetByPath({ ...((draft.current_data_json as Json) ?? {}) }, previous.field_key)
          : ((draft.current_data_json as Json) ?? {});
        await this.supabase
          .from("drafts")
          .update({ current_data_json: data as never })
          .eq("id", draft.id);
        await this.saveMeta(draft.id, { ...meta, history });
        await this.supabase
          .from("conversations")
          .update({ current_step_id: previous.id, status: "collecting" })
          .eq("id", conversationId);
        await this.reply(conversationId, this.renderStep(previous, draft));
        return { ok: true, state: "back", step_key: previous.key };
      }

      case "corrigir": {
        if (!draft) {
          await this.reply(conversationId, "Ainda não há dados preenchidos para corrigir.");
          return { ok: true, state: "correct_empty" };
        }
        const fields = this.flatFields((draft.current_data_json as Json) ?? {});
        if (fields.length === 0) {
          await this.reply(conversationId, "Ainda não há dados preenchidos para corrigir.");
          return { ok: true, state: "correct_empty" };
        }
        const list = fields.map((f, index) => `${index + 1}. ${f.path}: ${f.value}`).join("\n");
        await this.saveMeta(draft.id, {
          ...this.meta(draft),
          pending: "correct_select",
          correct_options: fields.map((f) => f.path),
        });
        await this.reply(
          conversationId,
          `Campos preenchidos:\n\n${list}\n\nResponda com o número do campo que deseja alterar.`,
        );
        return { ok: true, state: "correct_select" };
      }

      case "resumo": {
        if (!draft) {
          await this.reply(conversationId, "Nenhum rascunho em andamento.");
          return { ok: true, state: "summary_empty" };
        }
        await this.reply(conversationId, this.summaryText(draft));
        return { ok: true, state: "summary" };
      }

      case "cancelar": {
        if (!draft) {
          await this.reply(conversationId, "Não há nada em andamento para cancelar.");
          return { ok: true, state: "cancel_empty" };
        }
        await this.saveMeta(draft.id, { ...this.meta(draft), pending: "cancel_confirm" });
        await this.reply(
          conversationId,
          "Tem certeza que deseja cancelar? Todo o rascunho será descartado.\nResponda *SIM* para confirmar ou *NAO* para continuar.",
        );
        return { ok: true, state: "cancel_confirm" };
      }

      case "atendente": {
        await this.supabase
          .from("conversations")
          .update({ status: "human" })
          .eq("id", conversationId);
        await logAudit({
          organizationId: this.input.organization_id,
          action: "conversation.transfer_to_human",
          entityType: "conversation",
          entityId: conversationId,
          newData: { phone: this.input.phone_number },
        });
        await this.reply(
          conversationId,
          "Certo! Um atendente humano vai assumir esta conversa. Envie *MENU* para voltar ao atendimento automático.",
        );
        return { ok: true, state: "human_handoff" };
      }

      case "sair": {
        if (draft)
          await this.supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id);
        await this.supabase
          .from("conversations")
          .update({
            status: "finished",
            finished_at: new Date().toISOString(),
            current_flow_id: null,
            current_step_id: null,
          })
          .eq("id", conversationId);
        await this.reply(conversationId, "Atendimento encerrado. Quando precisar, é só chamar.");
        return { ok: true, state: "finished" };
      }
    }
  }

  private flatFields(data: Json, prefix = ""): Array<{ path: string; value: string }> {
    const result: Array<{ path: string; value: string }> = [];
    for (const [key, value] of Object.entries(data)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        result.push(...this.flatFields(value as Json, path));
      } else {
        result.push({ path, value: String(value) });
      }
    }
    return result;
  }

  private summaryText(draft: { current_data_json: unknown; document_type?: string }) {
    const fields = this.flatFields((draft.current_data_json as Json) ?? {});
    const label = DOC_LABEL[draft.document_type ?? ""] ?? "documento";
    if (fields.length === 0) return `Nenhum dado preenchido ainda para o ${label}.`;
    return `Resumo do ${label}:\n\n${fields.map((f) => `• ${f.path}: ${f.value}`).join("\n")}\n\nEnvie *CORRIGIR* para alterar algum campo.`;
  }

  // -------------------------------------------------------------------------
  // ETAPA 14 — resumo e confirmação (validação final na Okton)
  // -------------------------------------------------------------------------

  /** Formata o resumo exatamente como a Okton devolveu. */
  private formatOktonSummary(summary: OktonSummary, fallbackLabel: string) {
    const items = summary.items.length
      ? summary.items
          .map((item) => `• ${item.description}${item.detail ? `\n  ${item.detail}` : ""}`)
          .join("\n")
      : "Nenhum item informado pela Okton.";
    const totals = summary.totals.length
      ? summary.totals.map((total) => `• ${total.label}: ${total.value}`).join("\n")
      : "Sem totais informados pela Okton.";
    const emitter = [summary.company, summary.branch].filter(Boolean).join("\n") || "-";
    const docLabel = DOC_LABEL[summary.document_type] ?? (summary.document_type || fallbackLabel);
    return [
      "*RESUMO PARA EMISSÃO*",
      `Documento:\n${docLabel}`,
      `Emitente:\n${emitter}`,
      `Destinatário ou tomador:\n${summary.recipient || "-"}`,
      `Itens ou documentos:\n${items}`,
      `Valores:\n${totals}`,
    ].join("\n\n");
  }

  private confirmationMenu() {
    return "1 - Corrigir informação\n2 - Cancelar emissão\n3 - Falar com o suporte";
  }

  /**
   * Envia o documento completo para a validação final da Okton e apresenta o
   * resumo retornado por ela. O token de confirmação também vem da Okton.
   */
  private async sendFinalSummary(
    conversationId: string,
    draft: {
      id: string;
      document_type: string;
      current_data_json: unknown;
      validation_result_json: unknown;
      okton_draft_id?: string | null;
    },
  ): Promise<{ ok: boolean; state: string }> {
    const { data: conversation } = await this.supabase
      .from("conversations")
      .select("okton_company_id,okton_branch_id,company_cnpj")
      .eq("id", conversationId)
      .maybeSingle();

    const { OktonApiClient } = await import("./okton-client.server");
    const client = await OktonApiClient.forOrganization(this.input.organization_id, {
      conversationId,
    });
    const data = ((draft.current_data_json as Json) ?? {}) as Record<string, unknown>;
    const response = await client.validateDocumentParsed(draft.document_type, {
      company_id: conversation?.okton_company_id ?? null,
      cnpj: conversation?.company_cnpj ?? null,
      branch_id: conversation?.okton_branch_id ?? null,
      document_type: draft.document_type,
      draft_id: draft.okton_draft_id ?? null,
      data,
    });

    const result = response.data;
    if (!result) {
      await this.reply(
        conversationId,
        `Não consegui validar o documento na Okton agora.\n\nMotivo:\n${response.message || "Falha de comunicação."}\n\n${this.confirmationMenu()}`,
      );
      return { ok: false, state: "summary_unavailable" };
    }

    if (!result.valid) {
      const details = result.errors.length
        ? result.errors
            .map((item) => `• ${item.field ? `${item.field}: ` : ""}${item.message}`)
            .join("\n")
        : result.message;
      await this.reply(
        conversationId,
        `A Okton não aprovou o documento.\n\n${details}\n\n${this.confirmationMenu()}`,
      );
      return { ok: false, state: "document_invalid" };
    }

    if (!result.summary || !result.confirmation_token) {
      // Nunca montamos o resumo apenas com dados locais nem inventamos token.
      await this.reply(
        conversationId,
        `A Okton aprovou o documento, mas não devolveu o resumo e o código de confirmação. Sem esse código não é possível emitir.\n\n${this.confirmationMenu()}`,
      );
      return { ok: false, state: "summary_missing" };
    }

    const ttl =
      result.expires_in_seconds && result.expires_in_seconds > 0
        ? result.expires_in_seconds
        : CONFIRMATION_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    await this.saveMeta(draft.id, {
      ...this.meta(draft),
      confirmation: {
        token: result.confirmation_token,
        expires_at: expiresAt,
        okton_draft_id: result.draft_id,
      },
    });
    if (result.draft_id) {
      await this.supabase
        .from("drafts")
        .update({ okton_draft_id: result.draft_id, status: "awaiting_confirmation" })
        .eq("id", draft.id);
    }

    const label = DOC_LABEL[draft.document_type] ?? "documento";
    await this.reply(
      conversationId,
      [
        this.formatOktonSummary(result.summary, label),
        "Revise todas as informações antes de continuar.",
        `Para confirmar, digite:\nEMITIR ${result.confirmation_token}`,
        `O código expira em ${Math.round(ttl / 60)} minuto(s).`,
        this.confirmationMenu(),
      ].join("\n\n"),
    );
    return { ok: true, state: "summary_sent" };
  }

  // -------------------------------------------------------------------------
  // Identificação e seleção de fluxo
  // -------------------------------------------------------------------------

  /** Identificação na Okton (com cache por execução). Nunca consulta base externa. */
  private async identifyOnOkton(cnpj: string, conversationId: string) {
    if (this.identifyCache && this.identifyCache.cnpj === cnpj) return this.identifyCache.result;
    const { OktonApiClient } = await import("./okton-client.server");
    const client = await OktonApiClient.forOrganization(this.input.organization_id, {
      conversationId,
    });
    const response = await client.identifyCompany(cnpj, {
      phoneNumber: this.input.phone_number,
      channel: this.channel?.provider ?? "whatsapp",
    });
    const result =
      response.data && "found" in response.data && response.data.found === true
        ? response.data
        : null;
    this.identifyCache = { cnpj, result };
    return result;
  }

  private async handleCnpj(
    conversation: { id: string },
    text: string,
  ): Promise<ConversationEngineResult> {
    // 1. remove pontuação  2. valida apenas o formato
    const digits = text.replace(ONLY_DIGITS, "");
    if (!isCnpjFormatValid(digits)) {
      await this.reply(
        conversation.id,
        digits.length === 0 ? GREETING : "CNPJ inválido. Informe os 14 dígitos do CNPJ da empresa.",
      );
      return { ok: true, state: "awaiting_cnpj" };
    }

    // 3/4/5/6. quem decide é a Okton: nada é consultado ou criado localmente.
    const identified = await this.identifyOnOkton(digits, conversation.id);

    if (!identified) {
      await this.supabase
        .from("conversations")
        .update({ company_cnpj: null, okton_company_id: null, status: "company_not_found" })
        .eq("id", conversation.id);
      await this.reply(conversation.id, COMPANY_NOT_FOUND_MENU);
      return { ok: true, state: "company_not_found" };
    }

    await this.supabase
      .from("conversations")
      .update({
        company_cnpj: digits,
        okton_company_id: String(identified.company?.id ?? ""),
        okton_branch_id: null,
        status: "confirming_company",
      })
      .eq("id", conversation.id);

    await this.reply(
      conversation.id,
      `Empresa localizada:\n\n*${identified.company?.name || "(sem nome informado)"}*\nCNPJ: ${formatCnpj(digits)}\n\nDeseja continuar com esta empresa?\n\n1 - Sim\n2 - Informar outro CNPJ`,
    );
    return { ok: true, state: "confirming_company" };
  }

  private async askForCnpj(conversationId: string, message = GREETING) {
    await this.supabase
      .from("conversations")
      .update({
        company_cnpj: null,
        okton_company_id: null,
        okton_branch_id: null,
        status: "awaiting_cnpj",
      })
      .eq("id", conversationId);
    await this.reply(conversationId, message);
    return { ok: true, state: "awaiting_cnpj" } satisfies ConversationEngineResult;
  }

  private async handleCompanyConfirm(
    conversation: { id: string; company_cnpj: string | null },
    text: string,
  ): Promise<ConversationEngineResult> {
    const answer = normalize(text);
    if (["1", "sim", "s", "continuar"].includes(answer)) {
      if (!conversation.company_cnpj) return this.askForCnpj(conversation.id);
      return this.afterCompanyConfirmed(conversation.id, conversation.company_cnpj);
    }
    if (["2", "nao", "n", "outro", "outro cnpj"].includes(answer)) {
      return this.askForCnpj(conversation.id, "Certo. Informe o CNPJ da empresa.");
    }
    await this.reply(
      conversation.id,
      "Responda com o número da opção.\n\n1 - Sim\n2 - Informar outro CNPJ",
    );
    return { ok: true, state: "confirming_company" };
  }

  private async handleCompanyNotFound(
    conversation: { id: string },
    text: string,
  ): Promise<ConversationEngineResult> {
    const answer = normalize(text);
    if (["1", "tentar", "tentar novamente"].includes(answer)) {
      return this.askForCnpj(conversation.id, "Informe novamente o CNPJ da empresa.");
    }
    if (["2", "suporte", "atendente", "falar com o suporte"].includes(answer)) {
      await this.supabase
        .from("conversations")
        .update({ status: "human" })
        .eq("id", conversation.id);
      await this.reply(
        conversation.id,
        "Certo, vou transferir você para o suporte. Em instantes um atendente continuará o atendimento.",
      );
      return { ok: true, state: "human_handoff" };
    }
    if (["3", "encerrar", "sair"].includes(answer)) {
      await this.supabase
        .from("conversations")
        .update({ status: "finished", finished_at: new Date().toISOString() })
        .eq("id", conversation.id);
      await this.reply(conversation.id, "Atendimento encerrado. Quando precisar, é só chamar.");
      return { ok: true, state: "finished" };
    }
    await this.reply(conversation.id, COMPANY_NOT_FOUND_MENU);
    return { ok: true, state: "company_not_found" };
  }

  /** Filiais retornadas pela Okton: uma filial é selecionada automaticamente. */
  private async afterCompanyConfirmed(
    conversationId: string,
    cnpj: string,
  ): Promise<ConversationEngineResult> {
    const identified = await this.identifyOnOkton(cnpj, conversationId);
    if (!identified) {
      await this.supabase
        .from("conversations")
        .update({ status: "company_not_found" })
        .eq("id", conversationId);
      await this.reply(conversationId, COMPANY_NOT_FOUND_MENU);
      return { ok: true, state: "company_not_found" };
    }

    const branches = (identified.branches ?? []).filter((b) => b.active !== false);

    if (branches.length > 1) {
      await this.supabase
        .from("conversations")
        .update({ status: "selecting_branch" })
        .eq("id", conversationId);
      const list = branches.map((b, i) => `${i + 1} - ${b.name}`).join("\n");
      await this.reply(
        conversationId,
        `Esta empresa possui mais de uma filial na Okton.\n\nQual filial deseja usar?\n\n${list}`,
      );
      return { ok: true, state: "selecting_branch" };
    }

    const single = branches[0];
    if (single) {
      await this.supabase
        .from("conversations")
        .update({ okton_branch_id: String(single.id) })
        .eq("id", conversationId);
      await this.reply(conversationId, `Filial selecionada: *${single.name}*.`);
    }

    await this.supabase
      .from("conversations")
      .update({ status: "choosing_flow" })
      .eq("id", conversationId);
    return this.sendFlowMenu(conversationId, cnpj);
  }

  private async handleBranchSelection(
    conversation: { id: string; company_cnpj: string | null },
    text: string,
  ): Promise<ConversationEngineResult> {
    if (!conversation.company_cnpj) return this.askForCnpj(conversation.id);
    const identified = await this.identifyOnOkton(conversation.company_cnpj, conversation.id);
    const branches = (identified?.branches ?? []).filter((b) => b.active !== false);
    const answer = normalize(text);
    const index = Number(answer);
    const chosen =
      Number.isInteger(index) && index >= 1 && index <= branches.length
        ? branches[index - 1]
        : branches.find((b) => normalize(b.name) === answer);

    if (!chosen) {
      const list = branches.map((b, i) => `${i + 1} - ${b.name}`).join("\n");
      await this.reply(conversation.id, `Filial inválida. Escolha uma das opções:\n\n${list}`);
      return { ok: true, state: "selecting_branch" };
    }

    await this.supabase
      .from("conversations")
      .update({ okton_branch_id: String(chosen.id), status: "choosing_flow" })
      .eq("id", conversation.id);
    await this.reply(conversation.id, `Filial selecionada: *${chosen.name}*.`);
    return this.sendFlowMenu(conversation.id, conversation.company_cnpj);
  }

  /** Documentos permitidos: sempre segundo a Okton, nunca uma lista local. */
  private async allowedDocuments(conversationId: string, cnpj: string): Promise<string[]> {
    if (this.allowedDocsCache) return this.allowedDocsCache;
    const { data: conversation } = await this.supabase
      .from("conversations")
      .select("okton_branch_id")
      .eq("id", conversationId)
      .maybeSingle();

    const { OktonApiClient } = await import("./okton-client.server");
    const client = await OktonApiClient.forOrganization(this.input.organization_id, {
      conversationId,
    });
    const response = await client.listAllowedDocuments(
      cnpj,
      conversation?.okton_branch_id ?? undefined,
    );

    let docs = parseAllowedDocuments(response.data);
    if (docs.length === 0) {
      const identified = await this.identifyOnOkton(cnpj, conversationId);
      docs = identified?.allowed_documents ?? [];
    }
    this.allowedDocsCache = docs;
    return docs;
  }

  private async listFlows(cnpj: string | null, conversationId?: string) {
    const { data: company } = cnpj
      ? await this.supabase
          .from("companies")
          .select("id")
          .eq("organization_id", this.input.organization_id)
          .eq("cnpj", cnpj)
          .maybeSingle()
      : { data: null };

    let query = this.supabase
      .from("flow_definitions")
      .select("*")
      .eq("organization_id", this.input.organization_id)
      .eq("active", true);
    query = company?.id
      ? query.or(`company_id.eq.${company.id},company_id.is.null`)
      : query.is("company_id", null);
    const { data } = await query.order("document_type");
    const flows = data ?? [];

    if (!cnpj || !conversationId) return flows;
    const allowed = await this.allowedDocuments(conversationId, cnpj);
    if (allowed.length === 0) return [];
    return flows.filter((f) => allowed.includes(String(f.document_type).toLowerCase()));
  }

  private async sendFlowMenu(
    conversationId: string,
    cnpj: string | null,
  ): Promise<ConversationEngineResult> {
    const flows = await this.listFlows(cnpj, conversationId);
    if (flows.length === 0) {
      await this.reply(
        conversationId,
        "A Okton não autorizou nenhum tipo de documento para esta empresa/filial no momento. Envie *ATENDENTE* para falar com o suporte.",
      );
      return { ok: true, state: "no_flows" };
    }
    const menu = flows
      .map((f, i) => `${i + 1} - ${DOC_LABEL[f.document_type] ?? f.document_type}`)
      .join("\n");
    await this.reply(
      conversationId,
      `Qual documento deseja emitir?\n\n${menu}\n\nResponda com o número da opção.\nComandos: MENU, VOLTAR, CORRIGIR, RESUMO, CANCELAR, ATENDENTE, SAIR.`,
    );
    return { ok: true, state: "choosing_flow" };
  }

  private async chooseFlow(
    conversation: { id: string; company_cnpj: string | null },
    text: string,
  ): Promise<ConversationEngineResult> {
    const flows = await this.listFlows(conversation.company_cnpj);
    if (flows.length === 0) {
      await this.reply(conversation.id, "Nenhum fluxo de emissão configurado para esta empresa.");
      return { ok: true, state: "no_flows" };
    }
    const normalized = text.trim().toLowerCase();
    const index = Number(normalized);
    const chosen =
      flows.find((f) =>
        (f.trigger_keywords ?? []).some((k: string) => k.toLowerCase() === normalized),
      ) ??
      (Number.isInteger(index) && index >= 1 && index <= flows.length ? flows[index - 1] : null);

    if (!chosen) return this.sendFlowMenu(conversation.id, conversation.company_cnpj);

    const first =
      (await this.getStep(chosen.initial_step_id)) ??
      ((
        await this.supabase
          .from("flow_steps")
          .select("*")
          .eq("flow_id", chosen.id)
          .eq("active", true)
          .order("order")
          .limit(1)
          .maybeSingle()
      ).data as StepRow | null);

    if (!first) {
      await this.reply(conversation.id, "Este fluxo ainda não possui etapas configuradas.");
      return { ok: true, state: "flow_without_steps" };
    }

    await this.supabase.from("drafts").insert({
      organization_id: this.input.organization_id,
      conversation_id: conversation.id,
      document_type: chosen.document_type,
      status: "collecting",
      current_data_json: {} as never,
      validation_result_json: {} as never,
    });

    await this.supabase
      .from("conversations")
      .update({
        current_flow_id: chosen.id,
        document_type: chosen.document_type,
        status: "collecting",
      })
      .eq("id", conversation.id);

    await this.reply(
      conversation.id,
      `${DOC_LABEL[chosen.document_type] ?? chosen.document_type} selecionada.`,
    );
    return this.runFrom({ id: conversation.id, company_cnpj: conversation.company_cnpj }, first);
  }

  // -------------------------------------------------------------------------
  // Execução de etapas
  // -------------------------------------------------------------------------

  /** Executa etapas automáticas até encontrar uma que aguarde resposta do usuário. */
  private async runFrom(
    conversation: { id: string; company_cnpj?: string | null },
    startStep: StepRow,
  ): Promise<ConversationEngineResult> {
    let step: StepRow | null = startStep;
    let guard = 0;

    while (step && guard < 40) {
      guard += 1;
      const draft = await this.getDraft(conversation.id);
      const data = ((draft?.current_data_json as Json) ?? {}) as Json;

      if (draft) {
        const meta = this.meta(draft);
        const history = [...(meta.history ?? [])];
        if (history.at(-1) !== step.id) history.push(step.id);
        await this.saveMeta(draft.id, { ...meta, history });
      }

      await this.supabase
        .from("conversations")
        .update({ current_step_id: step.id })
        .eq("id", conversation.id);

      if (WAITING_STEPS.has(step.step_type)) {
        await this.reply(conversation.id, await this.waitingPrompt(step, data, conversation.id));
        return { ok: true, state: "waiting_input", step_key: step.key };
      }

      const outcome = await this.runAutomaticStep(step, conversation.id, draft);
      if (outcome.stop) return { ok: true, state: outcome.state, step_key: step.key };
      if (outcome.errorStep) {
        const errorStep = await this.getStep(step.error_step_id);
        if (errorStep) {
          step = errorStep;
          continue;
        }
        return { ok: true, state: outcome.state, step_key: step.key };
      }
      step = await this.nextStepOf(step);
    }

    if (!step) {
      await this.supabase
        .from("conversations")
        .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
        .eq("id", conversation.id);
      return { ok: true, state: "flow_completed" };
    }
    return { ok: true, state: "guard_stop" };
  }

  private async waitingPrompt(step: StepRow, data: Json, conversationId: string) {
    const config = (step.configuration_json ?? {}) as StepConfig;

    // ETAPA 11/12 — a pergunta vem do catálogo da Okton (campo a campo ou modelo).
    if (step.step_type === "collect_dynamic_fields") {
      const draft = await this.getDraft(conversationId);
      const meta = this.meta(draft);
      if (meta.input_mode === "bulk" && meta.bulk_stage === "awaiting_text") {
        return this.bulkTemplate(meta, draft, conversationId);
      }
      const current = this.currentField(meta);
      if (current.field) {
        const header = renderTemplate(step.message_template, data);
        const progress = `Campo ${current.index + 1} de ${this.fieldTotal(meta)}`;
        return [header, progress, buildFieldPrompt(current.field)].filter(Boolean).join("\n\n");
      }
    }

    const options = await this.resolveOptions(step, config, conversationId);
    const base =
      step.step_type === "select_input_mode"
        ? "Como deseja enviar as informações?"
        : renderTemplate(step.message_template, data);
    if (options.length === 0) return base;
    const list = options.map((o, i) => `${i + 1} - ${o.label}`).join("\n");
    return `${base}\n\n${list}\n\nResponda com o número da opção.`;
  }

  // -------------------------------------------------------------------------
  // ETAPA 11 — coleta campo por campo
  // -------------------------------------------------------------------------

  /** Todos os campos coletados: segue para a próxima etapa do fluxo. */
  private async continueAfterFields(conversation: {
    id: string;
    current_step_id: string | null;
  }): Promise<ConversationEngineResult> {
    const step = await this.getStep(conversation.current_step_id);
    if (!step) return { ok: true, state: "fields_completed" };
    const next = await this.nextStepOf(step);
    if (!next) {
      await this.supabase
        .from("conversations")
        .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
        .eq("id", conversation.id);
      return { ok: true, state: "flow_completed" };
    }
    return this.runFrom(conversation, next);
  }

  private currentField(meta: DraftMeta): { field: CollectField | null; index: number } {
    const fields = meta.required_fields ?? [];
    const index = Math.max(0, meta.field_index ?? 0);
    // ETAPA 12 — quando há fila de pendências, coletamos apenas esses campos.
    if (meta.queue && meta.queue.length > 0) {
      const key = meta.queue[index];
      return { field: fields.find((item) => item.key === key) ?? null, index };
    }
    return { field: fields[index] ?? null, index };
  }

  private fieldTotal(meta: DraftMeta): number {
    if (meta.queue && meta.queue.length > 0) return meta.queue.length;
    return (meta.required_fields ?? []).length;
  }

  // -------------------------------------------------------------------------
  // ETAPA 12 — envio de todos os campos de uma vez
  // -------------------------------------------------------------------------

  /** Modelo dinâmico gerado a partir do catálogo atual da Okton. */
  private async bulkTemplate(
    meta: DraftMeta,
    draft: { document_type?: string } | null,
    conversationId: string,
  ): Promise<string> {
    const { buildBulkTemplate } = await import("@/models/bulk-fill");
    const { data: conversation } = await this.supabase
      .from("conversations")
      .select("company_cnpj,okton_branch_id")
      .eq("id", conversationId)
      .maybeSingle();
    const branch = (meta.branches ?? []).find(
      (item) => item.id === (conversation?.okton_branch_id ?? ""),
    );
    return buildBulkTemplate(meta.required_fields ?? [], {
      documentLabel: draft?.document_type ?? null,
      companyName: conversation?.company_cnpj ?? null,
      branchName: branch?.name ?? null,
    });
  }

  /**
   * Recebe o texto preenchido, separa os campos, valida cada um na Okton e
   * devolve o relatório de válidos, inválidos e não informados.
   */
  private async processBulkFill(
    conversation: {
      id: string;
      okton_company_id: string | null;
      okton_branch_id?: string | null;
    },
    draft: {
      id: string;
      document_type: string;
      current_data_json: unknown;
      validation_result_json: unknown;
    },
    step: StepRow,
    text: string,
  ): Promise<{ ok: boolean; message?: string; halt?: ConversationEngineResult }> {
    const meta = this.meta(draft);
    const fields = meta.required_fields ?? [];
    const { parseBulkFill, describeParsed } = await import("@/models/bulk-fill");

    // Trocar para o modo guiado a qualquer momento.
    if (/^(campo|campos|um por vez|uma por vez|2)$/i.test(text.trim())) {
      return this.switchToGuided(
        conversation.id,
        draft,
        meta,
        fields.map((f) => f.key),
        step,
      );
    }

    // 1. separar os campos enviados.
    const parsed = parseBulkFill(text, fields);
    const provided = Object.keys(parsed.values);
    if (provided.length === 0) {
      // Texto não interpretável: nunca adivinhamos informação fiscal.
      const template = await this.bulkTemplate(meta, draft, conversation.id);
      await this.reply(
        conversation.id,
        `Não consegui interpretar as informações enviadas. Nada foi preenchido.\n\n${template}`,
      );
      return { ok: true, halt: { ok: true, state: "bulk_unparsed", step_key: step.key } };
    }

    // 2/3. estrutura temporária + eco dos campos identificados.
    await this.reply(
      conversation.id,
      `Campos identificados:\n\n${describeParsed(fields, parsed.values)}`,
    );

    const { OktonApiClient } = await import("./okton-client.server");
    const client = await OktonApiClient.forOrganization(this.input.organization_id, {
      conversationId: conversation.id,
    });

    const data = { ...((draft.current_data_json as Json) ?? {}) };
    const valid: string[] = [];
    const invalid: string[] = [];
    const pendingKeys: string[] = [];

    // 4. cada campo é validado na Okton (nenhuma regra fiscal local).
    for (const field of fields) {
      const raw = parsed.values[field.key];
      if (raw === undefined) {
        if (field.required !== false) pendingKeys.push(field.key);
        continue;
      }
      const prepared = prepareFieldValue(field, raw);
      if (!prepared.ok) {
        invalid.push(`• ${field.label}: ${prepared.message}`);
        pendingKeys.push(field.key);
        continue;
      }
      const validation = await client.validateFieldParsed(
        draft.document_type,
        field.key,
        prepared.value,
        {
          companyId: conversation.okton_company_id ?? undefined,
          branchId: conversation.okton_branch_id ?? null,
          draftData: data as Json,
        },
      );
      const result = validation.data;
      if (!result || result.valid === false) {
        const reason =
          result && result.valid === false
            ? result.message
            : validation.message || "A Okton não retornou o motivo da recusa.";
        invalid.push(`• ${field.label}: ${reason}`);
        pendingKeys.push(field.key);
        continue;
      }
      const value = result.normalized_value ?? prepared.value;
      setByPath(data, field.key, value);
      for (const [key, item] of Object.entries(result.resolved_data ?? {})) {
        if (key === field.key) continue;
        setByPath(data, key, item);
      }
      valid.push(`• ${field.label}: ${describeValue(value)}`);
    }

    await this.supabase
      .from("drafts")
      .update({ current_data_json: data as never })
      .eq("id", draft.id);

    const missing = fields
      .filter((field) => parsed.values[field.key] === undefined && field.required !== false)
      .map((field) => `• ${field.label}`);

    // 5/6/7. relatório.
    const report = [
      valid.length ? `✅ Campos válidos:\n${valid.join("\n")}` : "",
      invalid.length ? `❌ Campos inválidos:\n${invalid.join("\n")}` : "",
      missing.length ? `⚠️ Campos não informados:\n${missing.join("\n")}` : "",
      parsed.unknown.length
        ? `ℹ️ Ignorei o que não faz parte deste documento: ${parsed.unknown.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (report) await this.reply(conversation.id, report);

    // 8. corrigir apenas o que está pendente.
    if (pendingKeys.length === 0) {
      await this.saveMeta(draft.id, {
        ...meta,
        bulk_stage: null,
        queue: null,
        field_index: fields.length,
        pending: null,
        pending_field: null,
      });
      return {
        ok: true,
        halt: await this.continueAfterFields({
          id: conversation.id,
          current_step_id: step.id,
        }),
      };
    }

    const nextMeta: DraftMeta = {
      ...meta,
      bulk_stage: "correcting",
      queue: pendingKeys,
      field_index: 0,
      pending: null,
      pending_field: null,
    };
    await this.saveMeta(draft.id, nextMeta);
    const next = this.currentField(nextMeta);
    if (next.field) {
      await this.reply(
        conversation.id,
        `Vamos ajustar apenas o que ficou pendente.\n\nCampo ${next.index + 1} de ${pendingKeys.length}\n\n${buildFieldPrompt(next.field)}`,
      );
    }
    return { ok: true, halt: { ok: true, state: "bulk_pending_fields", step_key: step.key } };
  }

  /** Oferece/ativa o preenchimento campo por campo. */
  private async switchToGuided(
    conversationId: string,
    draft: { id: string },
    meta: DraftMeta,
    keys: string[],
    step: StepRow,
  ): Promise<{ ok: boolean; halt?: ConversationEngineResult }> {
    const nextMeta: DraftMeta = {
      ...meta,
      input_mode: "guided",
      bulk_stage: null,
      queue: keys,
      field_index: 0,
      pending: null,
      pending_field: null,
    };
    await this.saveMeta(draft.id, nextMeta);
    const next = this.currentField(nextMeta);
    if (next.field) {
      await this.reply(
        conversationId,
        `Campo ${next.index + 1} de ${keys.length}\n\n${buildFieldPrompt(next.field)}`,
      );
    }
    return { ok: true, halt: { ok: true, state: "switched_to_guided", step_key: step.key } };
  }

  private fieldErrorMenu(label: string, reason: string) {
    return `Não foi possível validar ${label}.\n\nMotivo:\n${reason}\n\n1 - Tentar novamente\n2 - Voltar\n3 - Falar com o suporte`;
  }

  /** Salva o valor normalizado e segue para o próximo campo. */
  private async commitField(
    conversationId: string,
    draft: { id: string; current_data_json: unknown },
    meta: DraftMeta,
    index: number,
    field: CollectField,
    value: unknown,
    resolved: Record<string, unknown>,
  ): Promise<ConversationEngineResult | null> {
    const data = { ...((draft.current_data_json as Json) ?? {}) };
    // 6/7. valor normalizado da Okton salvo no rascunho.
    setByPath(data, field.key, value);
    for (const [key, item] of Object.entries(resolved ?? {})) {
      if (key === field.key) continue;
      setByPath(data, key, item);
    }
    await this.supabase
      .from("drafts")
      .update({ current_data_json: data as never })
      .eq("id", draft.id);

    const nextMeta: DraftMeta = {
      ...meta,
      field_index: index + 1,
      last_field: field.key,
      pending: null,
      pending_field: null,
    };
    await this.saveMeta(draft.id, nextMeta);
    await this.reply(conversationId, `✅ ${field.label}: ${describeValue(value)}`);

    // 8. só avança quando o campo está válido.
    const next = this.currentField(nextMeta);
    if (!next.field) return null;
    await this.reply(
      conversationId,
      `Campo ${next.index + 1} de ${this.fieldTotal(nextMeta)}\n\n${buildFieldPrompt(next.field)}`,
    );
    return { ok: true, state: "collecting_field", step_key: field.key };
  }

  /** Envia o valor para validação na Okton e decide o próximo passo. */
  private async collectDynamicField(
    conversation: {
      id: string;
      okton_company_id: string | null;
      okton_branch_id?: string | null;
    },
    draft: {
      id: string;
      document_type: string;
      current_data_json: unknown;
      validation_result_json: unknown;
    },
    step: StepRow,
    text: string,
  ): Promise<{ ok: boolean; message?: string; halt?: ConversationEngineResult }> {
    const meta = this.meta(draft);

    // ETAPA 12 — modo em bloco: o texto preenchido chega inteiro aqui.
    if (meta.input_mode === "bulk" && meta.bulk_stage === "awaiting_text") {
      return this.processBulkFill(conversation, draft, step, text);
    }

    const { field, index } = this.currentField(meta);
    if (!field) return { ok: true };

    // Campo opcional pode ser pulado.
    if (field.required === false && /^(pular|skip)$/i.test(text.trim())) {
      const halt = await this.commitField(conversation.id, draft, meta, index, field, null, {});
      return halt ? { ok: true, halt } : { ok: true };
    }

    // Somente formato de entrada: nenhuma validação fiscal local.
    const prepared = prepareFieldValue(field, text);
    if (!prepared.ok) {
      await this.reply(conversation.id, `${prepared.message}\n\n${buildFieldPrompt(field)}`);
      return {
        ok: true,
        halt: { ok: true, state: "field_format_invalid", step_key: step.key },
      };
    }

    const { OktonApiClient } = await import("./okton-client.server");
    const client = await OktonApiClient.forOrganization(this.input.organization_id, {
      conversationId: conversation.id,
    });
    const data = ((draft.current_data_json as Json) ?? {}) as Json;
    const validation = await client.validateFieldParsed(
      draft.document_type,
      field.key,
      prepared.value,
      {
        companyId: conversation.okton_company_id ?? undefined,
        branchId: conversation.okton_branch_id ?? null,
        draftData: data,
      },
    );

    const result = validation.data;
    if (!result || result.valid === false) {
      const reason =
        result && result.valid === false
          ? [
              result.message,
              result.suggestions?.length ? `Sugestões: ${result.suggestions.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          : validation.message || "A Okton não retornou o motivo da recusa.";
      await this.saveMeta(draft.id, {
        ...meta,
        pending: "field_error",
        pending_field: { key: field.key },
      });
      await this.reply(conversation.id, this.fieldErrorMenu(field.label.toLowerCase(), reason));
      return { ok: true, halt: { ok: true, state: "field_invalid", step_key: step.key } };
    }

    const value = result.normalized_value ?? prepared.value;
    const resolved = result.resolved_data ?? {};
    const summary = resolvedSummary(resolved, result.display_value);

    if (summary && shouldConfirmField(field, Object.keys(resolved).length > 0)) {
      await this.saveMeta(draft.id, {
        ...meta,
        pending: "field_confirm",
        pending_field: { key: field.key, value, resolved },
      });
      await this.reply(
        conversation.id,
        `Encontrei:\n\n${summary}\n\nÉ este ${field.label.toLowerCase()}?\n\n1 - Sim\n2 - Não`,
      );
      return { ok: true, halt: { ok: true, state: "field_confirming", step_key: step.key } };
    }

    const halt = await this.commitField(
      conversation.id,
      draft,
      meta,
      index,
      field,
      value,
      resolved,
    );
    return halt ? { ok: true, halt } : { ok: true };
  }

  private async resolveOptions(
    step: StepRow,
    config: StepConfig,
    conversationId: string,
  ): Promise<Array<{ value: string; label: string }>> {
    if (step.step_type === "select_branch") {
      const draft = await this.getDraft(conversationId);
      const branches = this.meta(draft).branches ?? [];
      return branches.map((b) => ({ value: b.id, label: b.name }));
    }
    // ETAPA 10 — modos de preenchimento padrão do middleware.
    if (step.step_type === "select_input_mode" && !config.options) {
      return [
        { value: "bulk", label: "Enviar todos os campos de uma vez" },
        { value: "guided", label: "Responder uma informação por vez" },
        { value: "existing_draft", label: "Utilizar um rascunho existente" },
        { value: "cancel", label: "Cancelar" },
      ];
    }
    return (config.options ?? []).map((option) =>
      typeof option === "string" ? { value: option, label: option } : option,
    );
  }

  /** 3/5/6. Interpreta a resposta conforme o tipo da etapa e atualiza o rascunho. */
  private async applyAnswer(
    conversation: { id: string; company_cnpj: string | null; okton_company_id: string | null },
    draft: {
      id: string;
      document_type: string;
      current_data_json: unknown;
      validation_result_json: unknown;
    },
    step: StepRow,
    text: string,
  ): Promise<{ ok: boolean; message?: string; halt?: ConversationEngineResult }> {
    const config = (step.configuration_json ?? {}) as StepConfig;
    const data = { ...((draft.current_data_json as Json) ?? {}) };
    const fieldKey = step.field_key ?? step.key;

    if (step.step_type === "request_confirmation") {
      // ETAPA 14 — só o código de confirmação da Okton libera a emissão.
      const answer = text.trim();
      const meta = this.meta(draft);
      const confirmation = meta.confirmation ?? null;

      if (/^(2|cancelar|nao|não|n|0)$/i.test(answer)) {
        await this.saveMeta(draft.id, { ...meta, pending: "cancel_confirm" });
        return {
          ok: false,
          message: "Deseja realmente cancelar a emissão? Responda *SIM* ou *NAO*.",
        };
      }
      if (/^(3|suporte|atendente)$/i.test(answer)) {
        await this.supabase
          .from("conversations")
          .update({ status: "human" })
          .eq("id", conversation.id);
        await this.reply(conversation.id, "Certo! Um atendente humano vai assumir esta conversa.");
        return { ok: true, halt: { ok: true, state: "human_handoff", step_key: step.key } };
      }
      if (/^(1|corrigir)$/i.test(answer)) {
        const fields = this.flatFields((draft.current_data_json as Json) ?? {});
        await this.saveMeta(draft.id, {
          ...meta,
          confirmation: null,
          pending: "correct_select",
          correct_options: fields.map((f) => f.path),
        });
        await this.reply(
          conversation.id,
          `Campos preenchidos:\n\n${fields.map((f, index) => `${index + 1}. ${f.path}: ${f.value}`).join("\n")}\n\nResponda com o número do campo que deseja alterar.`,
        );
        return { ok: true, halt: { ok: true, state: "correct_select", step_key: step.key } };
      }

      if (!confirmation) {
        const summary = await this.sendFinalSummary(conversation.id, draft);
        return {
          ok: true,
          halt: {
            ok: true,
            state: summary.ok ? "summary_resent" : summary.state,
            step_key: step.key,
          },
        };
      }

      if (new Date(confirmation.expires_at).getTime() <= Date.now()) {
        await this.saveMeta(draft.id, { ...meta, confirmation: null });
        await this.reply(
          conversation.id,
          "O código de confirmação expirou. Vou validar o documento novamente na Okton.",
        );
        const summary = await this.sendFinalSummary(conversation.id, draft);
        return {
          ok: true,
          halt: {
            ok: true,
            state: summary.ok ? "confirmation_expired" : summary.state,
            step_key: step.key,
          },
        };
      }

      const match = answer.match(/^emitir\s+(\S+)$/i);
      if (!match) {
        return {
          ok: false,
          message: `Para confirmar é obrigatório enviar o código:\nEMITIR ${"*".repeat(confirmation.token.length)}\n\n${this.confirmationMenu()}`,
        };
      }
      if (match[1] !== confirmation.token) {
        return {
          ok: false,
          message: `Código de confirmação incorreto. Envie exatamente o código apresentado no resumo.\n\n${this.confirmationMenu()}`,
        };
      }

      setByPath(data, fieldKey, true);
      // ETAPA 15 — mantemos o token confirmado para compor a chave de idempotência.
      await this.saveMeta(draft.id, {
        ...meta,
        confirmation: { ...confirmation, confirmed_at: new Date().toISOString() },
      });
      await this.supabase
        .from("drafts")
        .update({ current_data_json: data as never, status: "confirmed" })
        .eq("id", draft.id);
      return { ok: true };
    }

    if (step.step_type === "identify_company") {
      const digits = text.replace(ONLY_DIGITS, "");
      if (digits.length !== 14) return { ok: false, message: "O CNPJ deve conter 14 dígitos." };
      const { OktonApiClient } = await import("./okton-client.server");
      const client = await OktonApiClient.forOrganization(this.input.organization_id, {
        conversationId: conversation.id,
      });
      const identified = await client.identifyCompany(digits, {
        phoneNumber: this.input.phone_number,
        channel: this.channel?.provider ?? "whatsapp",
      });
      if (!identified.success || !identified.data || !("company" in identified.data)) {
        return {
          ok: false,
          message: identified.message ?? "Não foi possível identificar esta empresa na Okton.",
        };
      }
      const branches = (identified.data.branches ?? []).map((b) => ({
        id: String(b.id),
        name: b.name ?? String(b.id),
      }));
      await this.saveMeta(draft.id, { ...this.meta(draft), branches, last_field: fieldKey });
      setByPath(data, fieldKey, digits);
      await this.supabase
        .from("drafts")
        .update({ current_data_json: data as never })
        .eq("id", draft.id);
      await this.supabase
        .from("conversations")
        .update({
          company_cnpj: digits,
          okton_company_id: String(identified.data.company?.id ?? ""),
        })
        .eq("id", conversation.id);
      return { ok: true };
    }

    if (
      step.step_type === "select_option" ||
      step.step_type === "select_branch" ||
      step.step_type === "select_document" ||
      step.step_type === "select_input_mode"
    ) {
      const options = await this.resolveOptions(step, config, conversation.id);
      if (options.length === 0) {
        setByPath(data, fieldKey, text.trim());
      } else {
        const index = Number(text.trim());
        const chosen =
          Number.isInteger(index) && index >= 1 && index <= options.length
            ? options[index - 1]
            : options.find(
                (o) =>
                  o.value.toLowerCase() === text.trim().toLowerCase() ||
                  o.label.toLowerCase() === text.trim().toLowerCase(),
              );
        if (!chosen) return { ok: false, message: "Opção inválida." };
        setByPath(data, fieldKey, chosen.value);
      }
      if (step.step_type === "select_branch") {
        await this.supabase
          .from("conversations")
          .update({ okton_branch_id: String(getByPath(data, fieldKey) ?? "") })
          .eq("id", conversation.id);
      }
      await this.supabase
        .from("drafts")
        .update({ current_data_json: data as never })
        .eq("id", draft.id);

      // ETAPA 10/12 — ações especiais do modo de preenchimento.
      if (step.step_type === "select_input_mode") {
        const mode = String(getByPath(data, fieldKey) ?? "");
        const currentMeta = this.meta(draft);
        if (mode === "bulk" || mode === "guided") {
          await this.saveMeta(draft.id, {
            ...currentMeta,
            input_mode: mode,
            bulk_stage: mode === "bulk" ? "awaiting_text" : null,
            queue: null,
            field_index: 0,
            pending: null,
            pending_field: null,
          });
        }
        if (mode === "cancel") {
          await this.supabase.from("drafts").update({ status: "discarded" }).eq("id", draft.id);
          await this.supabase
            .from("conversations")
            .update({ status: "choosing_flow", current_flow_id: null, current_step_id: null })
            .eq("id", conversation.id);
          await this.reply(conversation.id, "Emissão cancelada.");
          return {
            ok: true,
            halt: await this.sendFlowMenu(conversation.id, conversation.company_cnpj),
          };
        }
        if (mode === "existing_draft") {
          const { data: previous } = await this.supabase
            .from("drafts")
            .select("id,current_data_json")
            .eq("organization_id", this.input.organization_id)
            .eq("document_type", draft.document_type as never)
            .in("status", [...OPEN_DRAFT_STATUS])
            .neq("id", draft.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!previous) {
            return {
              ok: false,
              message: "Não encontrei um rascunho existente para este documento.",
            };
          }
          const restored = {
            ...((previous.current_data_json as Json) ?? {}),
            ...data,
          };
          await this.supabase
            .from("drafts")
            .update({ current_data_json: restored as never })
            .eq("id", draft.id);
          await this.reply(conversation.id, "Rascunho existente carregado. Vamos continuar.");
        }
      }
      return { ok: true };
    }

    // ETAPA 11 — coleta campo por campo (lista sempre vinda da Okton).
    if (step.step_type === "collect_dynamic_fields") {
      return this.collectDynamicField(conversation, draft, step, text);
    }

    // collect_value

    const inputType = config.input_type ?? "text";
    const value = coerce(inputType, text);
    const formatError = validateLocalFormat(
      {
        input_type: inputType,
        required: config.required ?? true,
        validation: (config.validation ?? null) as Json | null,
      },
      value,
    );
    if (formatError) return { ok: false, message: formatError };

    let finalValue = value;
    if (config.validate_with_okton) {
      const { OktonApiClient } = await import("./okton-client.server");
      const client = await OktonApiClient.forOrganization(this.input.organization_id, {
        conversationId: conversation.id,
      });
      const validation = await client.validateFieldParsed(draft.document_type, fieldKey, value, {
        companyId: conversation.okton_company_id ?? undefined,
        draftData: data,
      });
      if (validation.data && validation.data.valid === false) {
        const suggestions = validation.data.suggestions?.length
          ? `\nSugestões: ${validation.data.suggestions.join(", ")}`
          : "";
        return { ok: false, message: `${validation.data.message}${suggestions}` };
      }
      if (validation.data && validation.data.valid) {
        finalValue = validation.data.normalized_value ?? value;
        for (const [key, resolved] of Object.entries(validation.data.resolved_data ?? {})) {
          setByPath(data, key, resolved);
        }
      }
    }

    setByPath(data, fieldKey, finalValue);
    await this.supabase
      .from("drafts")
      .update({ current_data_json: data as never })
      .eq("id", draft.id);
    await this.saveMeta(draft.id, { ...this.meta(draft), last_field: fieldKey });
    return { ok: true };
  }

  /** Etapas que não aguardam resposta do usuário. */
  private async runAutomaticStep(
    step: StepRow,
    conversationId: string,
    draft: {
      id: string;
      document_type: string;
      idempotency_key: string;
      current_data_json: unknown;
      validation_result_json: unknown;
    } | null,
  ): Promise<{ stop: boolean; state: string; errorStep?: boolean }> {
    const data = ((draft?.current_data_json as Json) ?? {}) as Json;
    const message = renderTemplate(step.message_template, data);

    switch (step.step_type) {
      case "message": {
        if (message) await this.reply(conversationId, message);
        return { stop: false, state: "message" };
      }

      case "load_required_fields": {
        if (message) await this.reply(conversationId, message);
        if (!draft) return { stop: false, state: "no_draft" };
        const { OktonApiClient } = await import("./okton-client.server");
        const client = await OktonApiClient.forOrganization(this.input.organization_id, {
          conversationId,
        });
        const result = await client.getRequiredFieldsParsed(draft.document_type);
        if (!result.success || !result.data || result.data.fields.length === 0) {
          await this.reply(
            conversationId,
            "Não consegui obter na Okton a lista de informações necessárias para este documento. Envie *ATENDENTE* para falar com o suporte.",
          );
          return { stop: true, state: "required_fields_unavailable" };
        }
        const fields = result.data.fields;
        await this.saveMeta(draft.id, {
          ...this.meta(draft),
          // ETAPA 11 — guardamos o catálogo completo (tipo, descrição e opções)
          // exatamente como a Okton devolveu, para a coleta campo por campo.
          required_fields: fields.map((f) => ({
            key: f.key,
            label: f.label || f.key,
            description: f.description ?? null,
            type: f.type || "text",
            required: f.required !== false,
            options: f.options ?? [],
          })),
          field_index: 0,
          pending: null,
          pending_field: null,
        });

        // ETAPA 10 — a lista vem sempre da Okton, nunca de uma lista fixa local.
        const list = fields
          .map((f) => `• ${f.label || f.key}${f.required === false ? " (opcional)" : ""}`)
          .join("\n");
        await this.reply(
          conversationId,
          `Para emitir este documento, precisarei das seguintes informações:\n\n${list}`,
        );
        return { stop: false, state: "required_fields_loaded" };
      }

      case "validate_field": {
        if (!draft) return { stop: false, state: "no_draft" };
        const field = this.meta(draft).last_field;
        if (!field) return { stop: false, state: "nothing_to_validate" };
        const { OktonApiClient } = await import("./okton-client.server");
        const client = await OktonApiClient.forOrganization(this.input.organization_id, {
          conversationId,
        });
        const validation = await client.validateFieldParsed(
          draft.document_type,
          field,
          getByPath(data, field),
          { draftData: data },
        );
        if (validation.data && validation.data.valid === false) {
          await this.reply(conversationId, validation.data.message);
          return { stop: !step.error_step_id, state: "field_invalid", errorStep: true };
        }
        return { stop: false, state: "field_valid" };
      }

      case "show_summary": {
        if (!draft) return { stop: false, state: "no_draft" };
        if (message) await this.reply(conversationId, message);
        // ETAPA 14 — o resumo apresentado é o que a Okton devolveu na validação final.
        const summary = await this.sendFinalSummary(conversationId, draft);
        if (!summary.ok) return { stop: true, state: summary.state };
        return { stop: false, state: "summary" };
      }

      case "send_emission": {
        if (!draft) return { stop: true, state: "no_draft" };
        if (message) await this.reply(conversationId, message);
        const result = await this.emit(conversationId, draft);
        return result.ok
          ? { stop: false, state: "emitted" }
          : { stop: !step.error_step_id, state: "emission_error", errorStep: true };
      }

      case "wait_status": {
        if (message) await this.reply(conversationId, message);
        const { data: emission } = await this.supabase
          .from("emissions")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (emission?.okton_document_id) {
          const { OktonApiClient } = await import("./okton-client.server");
          const client = await OktonApiClient.forOrganization(this.input.organization_id, {
            conversationId,
          });
          const status = await client.getDocumentStatus(emission.okton_document_id);
          const payload = (status.data ?? {}) as Json;
          const okStatus = String(payload.status ?? payload.situacao ?? "").toLowerCase();
          if (okStatus) {
            await this.supabase
              .from("emissions")
              .update({
                status: okStatus.includes("autoriz")
                  ? "authorized"
                  : okStatus.includes("rejeit")
                    ? "rejected"
                    : emission.status,
                response_payload: payload as never,
              })
              .eq("id", emission.id);
            await this.reply(conversationId, `Status atual na Okton: ${okStatus}.`);
          }
        }
        return { stop: false, state: "status_checked" };
      }

      case "send_files": {
        const { data: emission } = await this.supabase
          .from("emissions")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const links = [emission?.pdf_url, emission?.xml_url].filter(Boolean).join("\n");
        await this.reply(
          conversationId,
          links
            ? `${message || "Segue o documento:"}\n${links}`
            : "Os arquivos serão enviados assim que a Okton disponibilizar.",
        );
        return { stop: false, state: "files_sent" };
      }

      case "transfer_to_human": {
        await this.supabase
          .from("conversations")
          .update({ status: "human" })
          .eq("id", conversationId);
        await this.reply(
          conversationId,
          message || "Vou transferir você para um atendente humano.",
        );
        return { stop: true, state: "human_handoff" };
      }

      case "finish": {
        if (message) await this.reply(conversationId, message);
        await this.supabase
          .from("conversations")
          .update({
            status: "finished",
            finished_at: new Date().toISOString(),
            current_flow_id: null,
            current_step_id: null,
          })
          .eq("id", conversationId);
        return { stop: true, state: "finished" };
      }

      default: {
        if (message) await this.reply(conversationId, message);
        return { stop: false, state: "unknown_step" };
      }
    }
  }

  /** Emissão — sempre delegada à Okton, com idempotência garantida. */
  /**
   * ETAPA 15 — solicitação de emissão.
   * Bloqueia o rascunho, deriva a chave de idempotência e envia à Okton.
   */
  private async emit(
    conversationId: string,
    draft: {
      id: string;
      document_type: string;
      idempotency_key: string;
      current_data_json: unknown;
      validation_result_json: unknown;
      okton_draft_id?: string | null;
    },
  ) {
    const meta = this.meta(draft);
    const confirmation = meta.confirmation ?? null;
    if (!confirmation?.token) {
      await this.reply(
        conversationId,
        "Não encontrei um código de confirmação válido. Vou apresentar o resumo novamente.",
      );
      return { ok: false };
    }

    const { data: conversation } = await this.supabase
      .from("conversations")
      .select("okton_company_id,okton_branch_id,phone_number,provider")
      .eq("id", conversationId)
      .maybeSingle();

    // Chave determinística: organização + empresa + filial + conversa + rascunho + token.
    const { createHash } = await import("node:crypto");
    const idempotencyKey = createHash("sha256")
      .update(
        [
          this.input.organization_id,
          conversation?.okton_company_id ?? "-",
          conversation?.okton_branch_id ?? "-",
          conversationId,
          draft.id,
          confirmation.token,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 40);

    // Bloqueio: nunca uma segunda emissão com a mesma chave.
    const { data: existing } = await this.supabase
      .from("emissions")
      .select("id,status,okton_document_id,protocol")
      .eq("organization_id", this.input.organization_id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      await this.reply(
        conversationId,
        `Esta solicitação já foi enviada à Okton (status: ${existing.status}).\nProtocolo interno: ${existing.protocol ?? existing.okton_document_id ?? "aguardando"}\n\nNenhum documento duplicado será gerado.`,
      );
      return { ok: existing.status !== "error" };
    }

    // Bloqueia temporariamente o rascunho enquanto a solicitação está em curso.
    await this.supabase.from("drafts").update({ status: "confirmed" }).eq("id", draft.id);
    await this.saveMeta(draft.id, { ...meta, pending: "emitting" });

    const requestPayload: Record<string, unknown> = {
      draft_id: draft.okton_draft_id ?? confirmation.okton_draft_id ?? draft.id,
      document_type: draft.document_type,
      company_id: conversation?.okton_company_id ?? null,
      branch_id: conversation?.okton_branch_id ?? null,
      channel: conversation?.provider ?? "whatsapp",
      phone_number: conversation?.phone_number ?? null,
      idempotency_key: idempotencyKey,
      confirmation_token: confirmation.token,
    };

    const { data: emission, error } = await this.supabase
      .from("emissions")
      .insert({
        organization_id: this.input.organization_id,
        draft_id: draft.id,
        conversation_id: conversationId,
        document_type: draft.document_type as "nfe" | "cte" | "mdfe",
        idempotency_key: idempotencyKey,
        status: "pending",
        request_payload: requestPayload as never,
      })
      .select("*")
      .single();

    if (error || !emission) {
      await this.saveMeta(draft.id, { ...meta, pending: null });
      // 23505 = índice único (organization_id, idempotency_key): corrida de duplicidade.
      if (error?.code === "23505") {
        await this.reply(
          conversationId,
          "Esta solicitação já foi enviada à Okton. Nenhum documento duplicado será gerado.",
        );
        return { ok: true };
      }
      await this.reply(
        conversationId,
        "Não foi possível registrar a solicitação de emissão. Tente novamente em instantes.",
      );
      return { ok: false };
    }

    const { OktonApiClient } = await import("./okton-client.server");
    const client = await OktonApiClient.forOrganization(this.input.organization_id, {
      conversationId,
    });
    const result = await client.issueDocument(requestPayload, idempotencyKey);
    const payload = (result.data ?? {}) as Json;

    const requestId = (payload.request_id ??
      payload.requestId ??
      payload.protocolo ??
      payload.protocol ??
      null) as string | null;
    const remoteStatus = String(payload.status ?? "").toLowerCase();

    await this.supabase
      .from("emissions")
      .update({
        // "submitted" = enviado para processamento na Okton.
        status: result.success ? "sent" : "error",
        response_payload: payload as never,
        okton_document_id: (payload.id ?? payload.documentId ?? payload.document_id ?? null) as
          string | null,
        access_key: (payload.chave ?? payload.accessKey ?? payload.access_key ?? null) as
          string | null,
        protocol: requestId,
        xml_url: (payload.xmlUrl ?? payload.xml_url ?? null) as string | null,
        pdf_url: (payload.pdfUrl ?? payload.pdf_url ?? payload.danfeUrl ?? null) as string | null,
        rejection: result.success ? null : ({ message: result.message, body: payload } as never),
      })
      .eq("id", emission.id);

    await logAudit({
      organizationId: this.input.organization_id,
      action: "okton.documento.emitir",
      entityType: "emission",
      entityId: emission.id,
      newData: { status: result.status_code, message: result.message, request_id: requestId },
    });

    if (!result.success) {
      // Libera o rascunho para correção, mas a chave já consumida não se repete.
      await this.saveMeta(draft.id, { ...meta, pending: null });
      await this.supabase.from("drafts").update({ status: "validating" }).eq("id", draft.id);
      await this.reply(
        conversationId,
        `Não foi possível enviar a solicitação agora.\nRetorno da Okton: ${result.message ?? "erro desconhecido"}`,
      );
      return { ok: false };
    }

    await this.saveMeta(draft.id, {
      ...meta,
      pending: null,
      confirmation: null,
    });

    const label = DOC_LABEL[draft.document_type] ?? draft.document_type;
    await this.reply(
      conversationId,
      [
        "Sua solicitação foi enviada para a Okton.",
        `Documento: ${label}`,
        `Protocolo interno: ${requestId ?? "aguardando"}`,
        `Status: ${remoteStatus.includes("process") || !remoteStatus ? "Em processamento" : remoteStatus}`,
        "Assim que houver retorno, enviaremos o resultado por aqui.",
      ].join("\n"),
    );
    return { ok: true };
  }
}

export function processInboundMessage(input: ConversationEngineInput) {
  return ConversationEngine.handle(input);
}
