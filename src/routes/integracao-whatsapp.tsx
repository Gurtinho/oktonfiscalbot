import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  HStack,
  Input,
  NativeSelect,
  SimpleGrid,
  Switch,
  Text,
} from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { toast } from "@/views/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";
import { useAuth } from "@/views/hooks/useAuth";

export const Route = createFileRoute("/integracao-whatsapp")({
  head: () => ({
    meta: [
      { title: "Integração WhatsApp | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Conecte qualquer provedor de WhatsApp ao bot fiscal: canais, webhook assinado e credenciais no servidor.",
      },
      { property: "og:title", content: "Integração WhatsApp | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Canais de WhatsApp, webhooks assinados e tokens de envio do Okton Fiscal Bot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WhatsAppIntegrationPage,
});

const emptyChannel = {
  display_name: "Zappfy",
  provider: "zappfy",
  base_url: "",
  send_url: "",
  instance_name: "",
  phone_number: "",
  environment: "homologacao",
  status: "disconnected",
  send_token_secret_name: "ZAPPFY_TOKEN",
  webhook_secret_name: "",
  signature_mode: "none",
  signature_header: "x-webhook-signature",
};

const channelSchema = z.object({
  instance_name: z.string().min(1, "Informe o identificador da instância"),
  provider: z.string().min(1, "Informe o provedor"),
});

function WhatsAppIntegrationPage() {
  const queryClient = useQueryClient();
  const { canConfigure, organizationId } = useAuth();
  const [form, setForm] = useState(emptyChannel);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: channels } = useQuery({
    queryKey: ["whatsapp_channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_channels")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const set = (key: keyof typeof emptyChannel, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const createChannel = async () => {
    const parsed = channelSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Verifique os campos destacados");
      return;
    }
    setErrors({});
    const { error } = await supabase.from("whatsapp_channels").insert({
      organization_id: organizationId,
      display_name: form.display_name.trim() || form.provider.trim(),
      provider: form.provider.trim().toLowerCase(),
      instance_name: form.instance_name.trim(),
      phone_number: form.phone_number.trim() || null,
      base_url: form.base_url.trim() || null,
      send_url: form.send_url.trim() || null,
      environment: form.environment,
      status: form.status,
      send_token_secret_name: form.send_token_secret_name.trim() || null,
      webhook_secret_name: form.webhook_secret_name.trim() || null,
      signature_mode: form.signature_mode,
      signature_header: form.signature_header.trim() || "x-webhook-signature",
      webhook_token: crypto.randomUUID().replace(/-/g, "").slice(0, 24),
    });
    if (error) return toast.error(error.message);
    toast.success("Canal criado. Copie a URL do webhook para o seu provedor.");
    setForm(emptyChannel);
    queryClient.invalidateQueries({ queryKey: ["whatsapp_channels"] });
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = (provider: string, token: string) =>
    `${origin}/api/public/webhooks/whatsapp/${provider}?token=${token}`;

  return (
    <AppShell
      title="Integração WhatsApp"
      description="Camada WhatsAppProvider: qualquer fornecedor que fale JSON pode ser conectado, sem travar o sistema em um único parceiro."
    >
      {canConfigure ? (
        <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
          <Card.Header>
            <Card.Title fontSize="base">Novo canal</Card.Title>
            <Card.Description>
              Nenhuma credencial é exposta no navegador — informe apenas o nome do segredo
              armazenado no servidor.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            <SimpleGrid gap="4" columns={{ base: 1, md: 2 }}>
              <Field.Root>
                <Field.Label>Nome do provedor</Field.Label>
                <Input
                  value={form.display_name}
                  onChange={(e) => set("display_name", e.target.value)}
                />
              </Field.Root>
              <Field.Root invalid={!!errors.provider}>
                <Field.Label>Chave do provedor (usada na URL do webhook)</Field.Label>
                <Input value={form.provider} onChange={(e) => set("provider", e.target.value)} />
                <Field.ErrorText>{errors.provider}</Field.ErrorText>
              </Field.Root>
              <Field.Root>
                <Field.Label>URL base</Field.Label>
                <Input
                  placeholder="https://api.provedor.com"
                  value={form.base_url}
                  onChange={(e) => set("base_url", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>URL de envio de texto (opcional)</Field.Label>
                <Input
                  placeholder="https://api.provedor.com/send-text"
                  value={form.send_url}
                  onChange={(e) => set("send_url", e.target.value)}
                />
              </Field.Root>
              <Field.Root invalid={!!errors.instance_name}>
                <Field.Label>Identificador da instância</Field.Label>
                <Input
                  value={form.instance_name}
                  onChange={(e) => set("instance_name", e.target.value)}
                />
                <Field.ErrorText>{errors.instance_name}</Field.ErrorText>
              </Field.Root>
              <Field.Root>
                <Field.Label>Número conectado</Field.Label>
                <Input
                  placeholder="5511999999999"
                  value={form.phone_number}
                  onChange={(e) => set("phone_number", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Nome do segredo do token</Field.Label>
                <Input
                  value={form.send_token_secret_name}
                  onChange={(e) => set("send_token_secret_name", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Nome do segredo de validação do webhook</Field.Label>
                <Input
                  placeholder="WHATSAPP_WEBHOOK_SECRET"
                  value={form.webhook_secret_name}
                  onChange={(e) => set("webhook_secret_name", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Modo de assinatura</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={form.signature_mode}
                    onChange={(e) => set("signature_mode", e.currentTarget.value)}
                  >
                    <option value="none">Sem assinatura (apenas token na URL)</option>
                    <option value="token">Token no cabeçalho</option>
                    <option value="hmac_sha256">HMAC SHA-256 do corpo</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Cabeçalho da assinatura</Field.Label>
                <Input
                  value={form.signature_header}
                  onChange={(e) => set("signature_header", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Ambiente</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={form.environment}
                    onChange={(e) => set("environment", e.currentTarget.value)}
                  >
                    <option value="homologacao">Homologação</option>
                    <option value="producao">Produção</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Status</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={form.status}
                    onChange={(e) => set("status", e.currentTarget.value)}
                  >
                    <option value="disconnected">Desconectado</option>
                    <option value="connected">Conectado</option>
                    <option value="paused">Pausado</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Button gridColumn={{ md: "span 2" }} onClick={createChannel}>
                Criar canal
              </Button>
            </SimpleGrid>
          </Card.Body>
        </Card.Root>
      ) : null}

      <SimpleGrid mt="4" gap="4" columns={{ base: 1, md: 2 }}>
        {(channels ?? []).length === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            Nenhum canal configurado.
          </Text>
        ) : null}
        {(channels ?? []).map((item) => (
          <Card.Root key={item.id} borderColor="border" bg="bg.panel" shadow="panel">
            <Card.Header>
              <Card.Title
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                gap="2"
                fontSize="base"
              >
                <Text truncate>{item.display_name || item.instance_name}</Text>
                <Badge variant="subtle">{item.provider}</Badge>
              </Card.Title>
              <Card.Description display="flex" flexWrap="wrap" gap="2" fontSize="xs">
                <span>Instância: {item.instance_name}</span>
                <span>· Número: {item.phone_number || "não informado"}</span>
                <span>· Ambiente: {item.environment}</span>
                <span>· Status: {item.status}</span>
              </Card.Description>
            </Card.Header>
            <Card.Body display="flex" flexDirection="column" gap="3">
              <Text fontSize="xs" color="fg.muted">
                URL do webhook:
              </Text>
              <Box
                wordBreak="break-all"
                rounded="l2"
                bg="bg.muted"
                p="2"
                fontFamily="mono"
                fontSize="xs"
              >
                {webhookUrl(item.provider, item.webhook_token)}
              </Box>
              <Text fontSize="xs" color="fg.muted">
                Validação: {item.signature_mode === "none" ? "token na URL" : item.signature_mode} (
                {item.signature_header})
              </Text>
              <HStack justify="space-between" gap="2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl(item.provider, item.webhook_token));
                    toast.success("URL copiada.");
                  }}
                >
                  <Copy /> Copiar
                </Button>
                <HStack gap="2" fontSize="xs" color="fg.muted">
                  <Text>Ativo</Text>
                  <Switch.Root
                    checked={item.active}
                    disabled={!canConfigure}
                    onCheckedChange={async (e) => {
                      await supabase
                        .from("whatsapp_channels")
                        .update({ active: e.checked })
                        .eq("id", item.id);
                      queryClient.invalidateQueries({ queryKey: ["whatsapp_channels"] });
                    }}
                  >
                    <Switch.HiddenInput />
                    <Switch.Control />
                  </Switch.Root>
                </HStack>
              </HStack>
            </Card.Body>
          </Card.Root>
        ))}
      </SimpleGrid>
    </AppShell>
  );
}
