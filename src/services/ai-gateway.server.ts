// Conexão com o provedor de IA (somente backend).
//
// Neutro em relação a fornecedor: funciona com qualquer API compatível com
// OpenAI (OpenAI, OpenRouter, Groq, Together, vLLM próprio, etc.).
//
// Variáveis de ambiente (somente servidor, nunca expostas ao frontend):
//   AI_API_KEY   - chave da API
//   AI_BASE_URL  - endpoint base (padrão: https://api.openai.com/v1)
//   AI_MODEL     - modelo padrão (padrão: gpt-4o-mini)
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4o-mini";

export function getAiConfig() {
  return {
    apiKey: process.env["AI_API_KEY"] ?? "",
    baseURL: process.env["AI_BASE_URL"] ?? DEFAULT_AI_BASE_URL,
    model: process.env["AI_MODEL"] ?? DEFAULT_AI_MODEL,
  };
}

export function createAiProvider(
  apiKey: string,
  options?: { baseURL?: string; structuredOutputs?: boolean },
) {
  return createOpenAICompatible({
    name: "ai",
    baseURL: options?.baseURL ?? DEFAULT_AI_BASE_URL,
    supportsStructuredOutputs: options?.structuredOutputs ?? false,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}
