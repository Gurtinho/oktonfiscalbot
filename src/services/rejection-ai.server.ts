// IA de apoio às rejeições fiscais (somente backend).
//
// LIMITE IMPORTANTE: a IA NÃO valida, calcula nem decide nada fiscal.
// Ela apenas traduz a rejeição já devolvida pela Okton para uma linguagem
// simples e sugere o próximo passo dentro do próprio fluxo do bot.
// A Okton continua sendo a única fonte oficial.
import { generateText } from "ai";
import { createAiProvider, getAiConfig } from "./ai-gateway.server";

export type RejectionInput = {
  code: string;
  friendly_message: string;
  technical_message: string;
  field: string | null;
  field_label: string | null;
  correctable: boolean;
  document_label: string;
};

export type RejectionExplanation = {
  /** Texto curto em português, pronto para enviar ao cliente no WhatsApp. */
  explanation: string;
  /** Ação prática sugerida (1 linha). */
  next_step: string;
  /** Modelo usado, para rastreabilidade no painel. */
  model: string;
  generated_at: string;
};

const SYSTEM_PROMPT = [
  "Você apoia um atendimento fiscal por WhatsApp no Brasil.",
  "Recebe uma rejeição já emitida pela SEFAZ/ERP Okton e a explica ao usuário final.",
  "Regras rígidas:",
  "- Nunca invente códigos, valores, alíquotas, tributos ou regras fiscais.",
  "- Nunca afirme que o documento foi autorizado.",
  "- Use apenas as informações fornecidas; se algo não foi informado, diga que não foi informado.",
  "- Escreva em português do Brasil, tom cordial e direto, sem jargão técnico.",
  "- Máximo de 2 frases na explicação e 1 frase no próximo passo.",
  "Responda exatamente neste formato, sem markdown:",
  "EXPLICACAO: <texto>",
  "PROXIMO_PASSO: <texto>",
].join("\n");

function parseResponse(text: string) {
  const explanation = text.match(/EXPLICACAO:\s*(.+)/i)?.[1]?.trim();
  const nextStep = text.match(/PROXIMO_PASSO:\s*(.+)/i)?.[1]?.trim();
  return { explanation, nextStep };
}

/**
 * Interpreta uma rejeição da Okton. Nunca lança: em qualquer falha (chave
 * ausente, limite de uso, indisponibilidade) devolve null e o fluxo segue
 * normalmente com a mensagem original da Okton.
 */
export async function interpretRejection(
  input: RejectionInput,
): Promise<RejectionExplanation | null> {
  const { apiKey, baseURL, model } = getAiConfig();
  if (!apiKey) {
    console.warn("[rejection-ai] AI_API_KEY ausente; seguindo sem interpretação.");
    return null;
  }

  const prompt = [
    `Documento: ${input.document_label}`,
    `Código da rejeição: ${input.code || "não informado"}`,
    `Mensagem da Okton: ${input.friendly_message || "não informada"}`,
    `Mensagem técnica: ${input.technical_message || "não informada"}`,
    `Campo relacionado: ${input.field_label ?? input.field ?? "não informado"}`,
    `A Okton indicou que o usuário consegue corrigir: ${input.correctable ? "sim" : "não"}`,
    "",
    input.correctable
      ? "O usuário pode corrigir o campo pelo próprio WhatsApp digitando 1."
      : "O usuário não consegue corrigir sozinho; oriente a falar com o suporte digitando 4.",
  ].join("\n");

  try {
    const provider = createAiProvider(apiKey, { baseURL });
    const { text } = await generateText({
      model: provider(model),
      system: SYSTEM_PROMPT,
      prompt,
    });

    const { explanation, nextStep } = parseResponse(text ?? "");
    if (!explanation) return null;

    return {
      explanation: explanation.slice(0, 400),
      next_step: (nextStep ?? "").slice(0, 200),
      model,
      generated_at: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 429 = limite de uso; 402 = créditos esgotados. Ambos são registrados e ignorados.
    console.error("[rejection-ai] falha ao interpretar rejeição:", message);
    return null;
  }
}
