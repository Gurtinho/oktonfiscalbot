// Camada de abstração de provedores de WhatsApp (ETAPA 8).
// Nenhum fornecedor é fixo no código: URL base, caminhos, campos do payload
// e o modo de validação de assinatura vêm da configuração do canal no painel.
// Credenciais nunca trafegam para o frontend — apenas nomes de segredos.

export type WhatsAppChannelConfig = {
  id: string;
  organization_id: string | null;
  company_id: string | null;
  provider: string;
  display_name?: string | null;
  instance_name: string;
  phone_number?: string | null;
  environment?: string | null;
  status?: string | null;
  base_url?: string | null;
  send_url?: string | null;
  send_token_secret_name?: string | null;
  webhook_secret_name?: string | null;
  signature_header?: string | null;
  signature_mode?: string | null;
  webhook_token?: string | null;
  payload_mapping?: unknown;
  active?: boolean;
};

export type ProviderMapping = {
  phoneField?: string;
  // teste "sorvete" — toField: permite mapear, por canal, o campo do
  // payload que traz o número que RECEBEU a mensagem (o número conectado,
  // não o do cliente), usado para filtrar pelo "Número conectado" da tela
  // de Integração WhatsApp.
  toField?: string;
  // teste "sorvete" — fim do bloco
  textField?: string;
  optionsField?: string;
  mediaUrlField?: string;
  captionField?: string;
  fileNameField?: string;
  messageIdField?: string;
  instanceField?: string;
  extra?: Record<string, unknown>;
  paths?: {
    text?: string;
    options?: string;
    document?: string;
    image?: string;
    read?: string;
  };
};

export type SendResult = {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
};

export type IncomingMessage = {
  phone: string | null;
  name: string | null;
  text: string | null;
  fromMe: boolean;
  messageId: string | null;
  messageType: string;
  timestamp: string | null;
  // teste "sorvete" — to: número que recebeu a mensagem (número conectado
  // do canal), extraído do payload para permitir filtrar pelo campo
  // "Número conectado" da tela de Integração WhatsApp.
  to: string | null;
  // teste "sorvete" — fim do bloco
  raw: Record<string, unknown>;
};

function readPath(payload: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      payload,
    );
}

function pickString(payload: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return String(value);
  }
  return null;
}

function normalizeTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();
  return raw;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class WhatsAppProvider {
  readonly channel: WhatsAppChannelConfig;
  private readonly mapping: ProviderMapping;

  constructor(channel: WhatsAppChannelConfig) {
    this.channel = channel;
    this.mapping = (channel.payload_mapping ?? {}) as ProviderMapping;
  }

  get name(): string {
    return this.channel.display_name || this.channel.provider;
  }

  private get token(): string | undefined {
    return this.channel.send_token_secret_name
      ? process.env[this.channel.send_token_secret_name]
      : undefined;
  }

  private get secret(): string | undefined {
    return this.channel.webhook_secret_name
      ? process.env[this.channel.webhook_secret_name]
      : undefined;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const token = this.token;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["apikey"] = token;
    }
    return headers;
  }

  private endpoint(kind: keyof NonNullable<ProviderMapping["paths"]>): string | null {
    const path = this.mapping.paths?.[kind];
    const base = this.channel.base_url?.replace(/\/+$/, "");
    if (path) {
      if (/^https?:\/\//i.test(path)) return path;
      if (base) return `${base}/${path.replace(/^\/+/, "")}`;
    }
    // Compatibilidade: canais antigos possuem apenas send_url.
    if (kind === "text" || kind === "options") return this.channel.send_url ?? base ?? null;
    return base ?? this.channel.send_url ?? null;
  }

  private async post(url: string | null, body: Record<string, unknown>): Promise<SendResult> {
    if (!url) return { ok: false, error: "Canal sem URL configurada para esta operação." };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          [this.mapping.instanceField || "instance"]: this.channel.instance_name,
          ...body,
          ...(this.mapping.extra ?? {}),
        }),
      });
      const text = await response.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* resposta não-JSON */
      }
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `Provedor respondeu ${response.status}`,
          data,
        };
      }
      return { ok: true, status: response.status, data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Falha no envio" };
    }
  }

  // ---- Métodos padronizados -------------------------------------------------

  async sendTextMessage(phone: string, text: string): Promise<SendResult> {
    return this.post(this.endpoint("text"), {
      [this.mapping.phoneField || "phone"]: phone,
      [this.mapping.textField || "message"]: text,
    });
  }

  async sendOptionsMessage(phone: string, text: string, options: string[]): Promise<SendResult> {
    const url = this.endpoint("options");
    const hasOptionsEndpoint = Boolean(this.mapping.paths?.options);
    if (!hasOptionsEndpoint) {
      // Fallback universal: lista numerada em texto simples.
      const numbered = options.map((option, index) => `${index + 1}. ${option}`).join("\n");
      return this.sendTextMessage(phone, `${text}\n\n${numbered}`);
    }
    return this.post(url, {
      [this.mapping.phoneField || "phone"]: phone,
      [this.mapping.textField || "message"]: text,
      [this.mapping.optionsField || "options"]: options,
    });
  }

  async sendDocument(
    phone: string,
    url: string,
    fileName: string,
    caption?: string,
  ): Promise<SendResult> {
    return this.post(this.endpoint("document"), {
      [this.mapping.phoneField || "phone"]: phone,
      [this.mapping.mediaUrlField || "url"]: url,
      [this.mapping.fileNameField || "fileName"]: fileName,
      [this.mapping.captionField || "caption"]: caption ?? "",
    });
  }

  async sendImage(phone: string, url: string, caption?: string): Promise<SendResult> {
    return this.post(this.endpoint("image"), {
      [this.mapping.phoneField || "phone"]: phone,
      [this.mapping.mediaUrlField || "url"]: url,
      [this.mapping.captionField || "caption"]: caption ?? "",
    });
  }

  async markMessageAsRead(phone: string, messageId: string): Promise<SendResult> {
    if (!this.mapping.paths?.read) return { ok: true };
    return this.post(this.endpoint("read"), {
      [this.mapping.phoneField || "phone"]: phone,
      [this.mapping.messageIdField || "messageId"]: messageId,
    });
  }

  static parseIncomingWebhook(
    payload: Record<string, unknown>,
    mapping?: ProviderMapping,
  ): IncomingMessage {
    const phoneRaw = pickString(payload, [
      "phone",
      "from",
      "sender",
      "data.phone",
      "data.from",
      "message.from",
      "data.key.remoteJid",
      "key.remoteJid",
    ]);
    // teste "sorvete" — número que recebeu a mensagem (o número conectado
    // do canal). mapping.toField tem prioridade quando o provedor for
    // configurado explicitamente; senão tenta os caminhos mais comuns.
    const toRaw = pickString(payload, [
      ...(mapping?.toField ? [mapping.toField] : []),
      "to",
      "receiver",
      "owner",
      "instanceOwner",
      "connectedPhone",
      "data.to",
      "data.owner",
      "data.instanceOwner",
      "data.connectedPhone",
      "instance.owner",
    ]);
    // teste "sorvete" — fim do bloco
    return {
      phone: phoneRaw ? phoneRaw.replace(/[^0-9]/g, "") || null : null,
      // teste "sorvete" — mesma normalização (só dígitos) usada no phone,
      // pra comparar de forma consistente com o "Número conectado".
      to: toRaw ? toRaw.replace(/[^0-9]/g, "") || null : null,
      // teste "sorvete" — fim do bloco
      name: pickString(payload, [
        "senderName",
        "pushName",
        "data.pushName",
        "contact.name",
        "name",
      ]),
      // teste "sorvete" — "message.body" adicionado: é onde o provedor atual
      // manda o texto do cliente (confirmado inspecionando o payload_json
      // bruto na tela de Webhooks); sem esse path o texto nunca era achado
      // e a mensagem caía em "ignored" mesmo sendo do cliente.
      text: pickString(payload, [
        "text",
        "message",
        "body",
        "data.text",
        "data.body",
        "data.message.conversation",
        "message.conversation",
        "message.text.body",
        "message.body",
        "data.message.extendedTextMessage.text",
      ]),
      // teste "sorvete" — fim do bloco
      fromMe:
        pickString(payload, ["fromMe", "data.key.fromMe", "key.fromMe", "data.fromMe"]) === "true",
      messageId: pickString(payload, [
        "messageId",
        "id",
        "data.id",
        "data.key.id",
        "key.id",
        "message.id",
      ]),
      messageType:
        pickString(payload, ["messageType", "type", "data.messageType", "data.type"]) ?? "text",
      timestamp: normalizeTimestamp(
        pickString(payload, [
          "timestamp",
          "data.messageTimestamp",
          "messageTimestamp",
          "data.timestamp",
        ]),
      ),
      raw: payload,
    };
  }

  parseIncomingWebhook(payload: Record<string, unknown>): IncomingMessage {
    return WhatsAppProvider.parseIncomingWebhook(payload, this.mapping);
  }

  /**
   * Modos suportados (configuráveis por canal):
   * - none: sem validação (apenas o token secreto da URL protege o webhook).
   * - token: o header deve conter exatamente o segredo.
   * - hmac_sha256: HMAC hex do corpo bruto com o segredo (aceita prefixo "sha256=").
   */
  async validateWebhookSignature(
    rawBody: string,
    headers: Headers,
  ): Promise<{ valid: boolean; reason?: string }> {
    const mode = (this.channel.signature_mode || "none").toLowerCase();
    if (mode === "none") return { valid: true };

    const secret = this.secret;
    if (!secret)
      return { valid: false, reason: "Segredo de validação não configurado no servidor." };

    const headerName = this.channel.signature_header || "x-webhook-signature";
    const provided = headers.get(headerName)?.trim();
    if (!provided) return { valid: false, reason: `Header ${headerName} ausente.` };

    if (mode === "token") {
      return timingSafeEqual(provided, secret)
        ? { valid: true }
        : { valid: false, reason: "Assinatura inválida." };
    }

    if (mode === "hmac_sha256") {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = toHex(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
      );
      const normalized = provided.replace(/^sha256=/i, "").toLowerCase();
      return timingSafeEqual(normalized, digest)
        ? { valid: true }
        : { valid: false, reason: "Assinatura HMAC inválida." };
    }

    return { valid: false, reason: `Modo de assinatura desconhecido: ${mode}` };
  }
}

export function providerForChannel(channel: WhatsAppChannelConfig): WhatsAppProvider {
  return new WhatsAppProvider(channel);
}
