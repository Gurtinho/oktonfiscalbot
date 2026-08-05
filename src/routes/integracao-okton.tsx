import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { PlugZap, RefreshCcw, Save, ShieldCheck, Trash2 } from "lucide-react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Card,
  Field,
  HStack,
  Icon,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { toast } from "@/views/lib/toast";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";
import { useAuth } from "@/views/hooks/useAuth";
import { testOktonConnection, seedDefaultEndpoints } from "@/controllers/okton.functions";

export const Route = createFileRoute("/integracao-okton")({
  head: () => ({
    meta: [
      { title: "Integração Okton | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Configure a conexão com o ERP Okton, autenticação, tentativas e os endpoints usados por cada operação do bot fiscal.",
      },
      { property: "og:title", content: "Integração Okton | Okton Fiscal Bot" },
      {
        property: "og:description",
        content:
          "Conexões, ambiente, credenciais por secret e endpoints configuráveis do ERP Okton.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OktonIntegrationPage,
});

type TestResult = {
  ok: boolean;
  status: number;
  message?: string;
  durationMs?: number;
  attempts?: number;
  testedAt?: string;
  credentialsConfigured?: boolean;
};

const AUTH_TYPES = [
  { value: "bearer", label: "Bearer token" },
  { value: "apikey", label: "Chave de API" },
  { value: "basic", label: "Basic (client ID + secret)" },
  { value: "oauth2", label: "OAuth2 client credentials" },
  { value: "none", label: "Sem autenticação" },
];

const emptyConnection = {
  name: "Okton",
  base_url: "",
  environment: "homologacao",
  authentication_type: "bearer",
  token_secret_name: "OKTON_API_TOKEN",
  client_id_secret_name: "OKTON_CLIENT_ID",
  client_secret_secret_name: "OKTON_CLIENT_SECRET",
  api_key_secret_name: "OKTON_API_KEY",
  timeout_seconds: 30,
  retry_count: 2,
  retry_interval_ms: 1000,
  active: true,
};

const connectionSchema = z.object({
  name: z.string().min(1, "Informe o nome da conexão"),
  base_url: z.url("Informe uma URL base válida"),
});

function showsToken(type: string) {
  return type === "bearer";
}
function showsApiKey(type: string) {
  return type === "apikey";
}
function showsClientPair(type: string) {
  return type === "basic" || type === "oauth2";
}

function OktonIntegrationPage() {
  const queryClient = useQueryClient();
  const { canConfigure, organizationId } = useAuth();
  const testConnection = useServerFn(testOktonConnection);
  const seedEndpoints = useServerFn(seedDefaultEndpoints);

  const [draft, setDraft] = useState({ ...emptyConnection });
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const { data: connections } = useQuery({
    queryKey: ["api_connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_connections")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: endpoints } = useQuery({
    queryKey: ["api_endpoints"],
    queryFn: async () => {
      const { data, error } = await supabase.from("api_endpoints").select("*").order("key");
      if (error) throw error;
      return data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["api_connections"] });
    queryClient.invalidateQueries({ queryKey: ["api_endpoints"] });
  };

  const createConnection = async () => {
    const parsed = connectionSchema.safeParse({ name: draft.name, base_url: draft.base_url });
    if (!parsed.success) {
      setDraftErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      toast.error("Verifique os campos destacados");
      return;
    }
    if (!organizationId) return toast.error("Organização não identificada.");
    setDraftErrors({});
    const { error } = await supabase.from("api_connections").insert({
      organization_id: organizationId,
      name: draft.name.trim(),
      base_url: draft.base_url.trim().replace(/\/+$/, ""),
      environment: draft.environment,
      authentication_type: draft.authentication_type,
      encrypted_credentials_reference: draft.token_secret_name.trim() || "OKTON_API_TOKEN",
      token_secret_name: draft.token_secret_name.trim() || null,
      client_id_secret_name: draft.client_id_secret_name.trim() || null,
      client_secret_secret_name: draft.client_secret_secret_name.trim() || null,
      api_key_secret_name: draft.api_key_secret_name.trim() || null,
      timeout_seconds: Number(draft.timeout_seconds) || 30,
      retry_count: Number(draft.retry_count) || 0,
      retry_interval_ms: Number(draft.retry_interval_ms) || 0,
      active: draft.active,
    });
    if (error) return toast.error(error.message);
    toast.success("Conexão criada.");
    setDraft({ ...emptyConnection });
    invalidate();
  };

  const updateConnection = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from("api_connections")
      .update(patch as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conexão atualizada.");
    invalidate();
  };

  const removeConnection = async (id: string) => {
    const { error } = await supabase.from("api_connections").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conexão removida.");
    invalidate();
  };

  const runTest = async (connectionId: string) => {
    setTesting(connectionId);
    try {
      const result = (await testConnection({ data: { connectionId } })) as TestResult;
      setResults((prev) => ({ ...prev, [connectionId]: result }));
      if (result.ok) toast.success(`Conexão realizada (HTTP ${result.status}).`);
      else toast.error(result.message ?? `Falha na conexão (HTTP ${result.status}).`);
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao testar conexão.");
    } finally {
      setTesting(null);
    }
  };

  const runSeed = async (connectionId: string) => {
    const result = await seedEndpoints({ data: { connectionId } });
    if (!result.ok) return toast.error(result.error ?? "Falha ao criar endpoints.");
    toast.success("Catálogo de endpoints sincronizado.");
    invalidate();
  };

  return (
    <AppShell
      title="Integração Okton"
      description="A Okton é a fonte oficial de dados fiscais. Aqui definimos apenas como o bot conversa com ela — nenhuma credencial é gravada no banco."
    >
      <Tabs.Root defaultValue="conexoes">
        <Tabs.List>
          <Tabs.Trigger value="conexoes">Conexões</Tabs.Trigger>
          <Tabs.Trigger value="endpoints">Endpoints da Okton</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="conexoes">
          <Stack gap="4" pt="4">
            <Card.Root borderColor="border.brand" bg="bg.panel" shadow="panel">
              <Card.Header display="flex" flexDirection="row" alignItems="flex-start" gap="3">
                <Icon as={ShieldCheck} boxSize="5" color="fg.brand" mt="0.5" />
                <Box>
                  <Card.Title fontSize="base">Credenciais ficam apenas no backend</Card.Title>
                  <Card.Description>
                    Os campos abaixo guardam somente o <strong>nome</strong> do secret. Os valores
                    reais (token, client secret, chave de API) são armazenados como secrets do
                    servidor e nunca trafegam para o navegador nem para tabelas do banco.
                  </Card.Description>
                </Box>
              </Card.Header>
            </Card.Root>

            {canConfigure ? (
              <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
                <Card.Header>
                  <Card.Title fontSize="base">Nova conexão</Card.Title>
                  <Card.Description>
                    Os campos de credencial mudam conforme o tipo de autenticação escolhido.
                  </Card.Description>
                </Card.Header>
                <Card.Body>
                  <SimpleGrid gap="4" columns={{ base: 1, md: 2 }}>
                    <Field.Root invalid={!!draftErrors.name}>
                      <Field.Label>Nome da conexão</Field.Label>
                      <Input
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                      <Field.ErrorText>{draftErrors.name}</Field.ErrorText>
                    </Field.Root>
                    <Field.Root invalid={!!draftErrors.base_url}>
                      <Field.Label>URL base</Field.Label>
                      <Input
                        placeholder="https://api.okton.com.br"
                        value={draft.base_url}
                        onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
                      />
                      <Field.ErrorText>{draftErrors.base_url}</Field.ErrorText>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Ambiente</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={draft.environment}
                          onChange={(e) =>
                            setDraft({ ...draft, environment: e.currentTarget.value })
                          }
                        >
                          <option value="homologacao">Homologação</option>
                          <option value="producao">Produção</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Tipo de autenticação</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={draft.authentication_type}
                          onChange={(e) =>
                            setDraft({ ...draft, authentication_type: e.currentTarget.value })
                          }
                        >
                          {AUTH_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>

                    {showsToken(draft.authentication_type) ? (
                      <Field.Root gridColumn={{ md: "span 2" }}>
                        <Field.Label>Nome do secret do token</Field.Label>
                        <Input
                          value={draft.token_secret_name}
                          onChange={(e) =>
                            setDraft({ ...draft, token_secret_name: e.target.value })
                          }
                        />
                      </Field.Root>
                    ) : null}

                    {showsApiKey(draft.authentication_type) ? (
                      <Field.Root gridColumn={{ md: "span 2" }}>
                        <Field.Label>Nome do secret da chave de API</Field.Label>
                        <Input
                          value={draft.api_key_secret_name}
                          onChange={(e) =>
                            setDraft({ ...draft, api_key_secret_name: e.target.value })
                          }
                        />
                      </Field.Root>
                    ) : null}

                    {showsClientPair(draft.authentication_type) ? (
                      <>
                        <Field.Root>
                          <Field.Label>Nome do secret do Client ID</Field.Label>
                          <Input
                            value={draft.client_id_secret_name}
                            onChange={(e) =>
                              setDraft({ ...draft, client_id_secret_name: e.target.value })
                            }
                          />
                        </Field.Root>
                        <Field.Root>
                          <Field.Label>Nome do secret do Client Secret</Field.Label>
                          <Input
                            value={draft.client_secret_secret_name}
                            onChange={(e) =>
                              setDraft({ ...draft, client_secret_secret_name: e.target.value })
                            }
                          />
                        </Field.Root>
                      </>
                    ) : null}

                    <Field.Root>
                      <Field.Label>Tempo limite (segundos)</Field.Label>
                      <Input
                        type="number"
                        min={1}
                        value={draft.timeout_seconds}
                        onChange={(e) =>
                          setDraft({ ...draft, timeout_seconds: Number(e.target.value) })
                        }
                      />
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Novas tentativas</Field.Label>
                      <Input
                        type="number"
                        min={0}
                        max={5}
                        value={draft.retry_count}
                        onChange={(e) =>
                          setDraft({ ...draft, retry_count: Number(e.target.value) })
                        }
                      />
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Intervalo entre tentativas (ms)</Field.Label>
                      <Input
                        type="number"
                        min={0}
                        value={draft.retry_interval_ms}
                        onChange={(e) =>
                          setDraft({ ...draft, retry_interval_ms: Number(e.target.value) })
                        }
                      />
                    </Field.Root>
                    <HStack gap="3" pt="6">
                      <Switch.Root
                        checked={draft.active}
                        onCheckedChange={(e) => setDraft({ ...draft, active: e.checked })}
                      >
                        <Switch.HiddenInput />
                        <Switch.Control />
                      </Switch.Root>
                      <Text>Conexão ativa</Text>
                    </HStack>

                    <Button gridColumn={{ md: "span 2" }} onClick={createConnection}>
                      Criar conexão
                    </Button>
                  </SimpleGrid>
                </Card.Body>
              </Card.Root>
            ) : null}

            <SimpleGrid gap="4" columns={{ base: 1, xl: 2 }}>
              {(connections ?? []).length === 0 ? (
                <Text fontSize="sm" color="fg.muted">
                  Nenhuma conexão configurada.
                </Text>
              ) : null}
              {(connections ?? []).map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  canConfigure={canConfigure}
                  testing={testing === connection.id}
                  result={results[connection.id]}
                  onTest={() => runTest(connection.id)}
                  onSeed={() => runSeed(connection.id)}
                  onSave={(patch) => updateConnection(connection.id, patch)}
                  onDelete={() => removeConnection(connection.id)}
                />
              ))}
            </SimpleGrid>
          </Stack>
        </Tabs.Content>

        <Tabs.Content value="endpoints">
          <Stack gap="4" pt="4">
            <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
              <Card.Header>
                <Card.Title fontSize="base">Endpoints da Okton</Card.Title>
                <Card.Description>
                  Cada operação do bot chama uma chave abaixo. Ajuste método, caminho, cabeçalhos e
                  os mapeamentos de request/response conforme a documentação da Okton. Use
                  “Sincronizar catálogo” em uma conexão para criar as operações padrão.
                </Card.Description>
              </Card.Header>
              <Card.Body>
                {(endpoints ?? []).length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    Nenhum endpoint configurado ainda.
                  </Text>
                ) : (
                  <Accordion.Root multiple w="full">
                    {endpoints?.map((endpoint) => (
                      <EndpointRow
                        key={endpoint.id}
                        endpoint={endpoint}
                        canConfigure={canConfigure}
                        onSaved={invalidate}
                      />
                    ))}
                  </Accordion.Root>
                )}
              </Card.Body>
            </Card.Root>
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </AppShell>
  );
}

function ConnectionCard({
  connection,
  canConfigure,
  testing,
  result,
  onTest,
  onSeed,
  onSave,
  onDelete,
}: {
  connection: Tables<"api_connections">;
  canConfigure: boolean;
  testing: boolean;
  result?: TestResult;
  onTest: () => void;
  onSeed: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState({
    name: connection.name ?? "",
    base_url: connection.base_url ?? "",
    environment: connection.environment ?? "homologacao",
    authentication_type: connection.authentication_type ?? "bearer",
    token_secret_name:
      connection.token_secret_name ?? connection.encrypted_credentials_reference ?? "",
    client_id_secret_name: connection.client_id_secret_name ?? "",
    client_secret_secret_name: connection.client_secret_secret_name ?? "",
    api_key_secret_name: connection.api_key_secret_name ?? "",
    timeout_seconds: connection.timeout_seconds ?? 30,
    retry_count: connection.retry_count ?? 0,
    retry_interval_ms: connection.retry_interval_ms ?? 1000,
    webhook_secret_name: connection.webhook_secret_name ?? "OKTON_WEBHOOK_SECRET",
    webhook_signature_header: connection.webhook_signature_header ?? "x-okton-signature",
    webhook_signature_mode: connection.webhook_signature_mode ?? "hmac_sha256",
    active: connection.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const shown: TestResult | undefined =
    result ??
    (connection.last_test_at
      ? {
          ok: Boolean(connection.last_test_ok),
          status: connection.last_test_status ?? 0,
          message: connection.last_test_message ?? undefined,
          durationMs: connection.last_test_duration_ms ?? undefined,
          testedAt: connection.last_test_at,
        }
      : undefined);

  const submit = () => {
    const parsed = connectionSchema.safeParse({ name: form.name, base_url: form.base_url });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Verifique os campos destacados");
      return;
    }
    setErrors({});
    onSave({
      ...form,
      base_url: form.base_url.trim().replace(/\/+$/, ""),
      encrypted_credentials_reference:
        form.token_secret_name || connection.encrypted_credentials_reference,
      token_secret_name: form.token_secret_name || null,
      client_id_secret_name: form.client_id_secret_name || null,
      client_secret_secret_name: form.client_secret_secret_name || null,
      api_key_secret_name: form.api_key_secret_name || null,
      webhook_secret_name: form.webhook_secret_name || null,
    });
  };

  return (
    <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
      <Card.Header>
        <Card.Title
          display="flex"
          alignItems="center"
          justifyContent="space-between"
          gap="2"
          fontSize="base"
        >
          <Text truncate>{connection.name}</Text>
          <HStack gap="2">
            <Badge variant="outline">{connection.environment}</Badge>
            <Badge variant={connection.active ? "subtle" : "outline"}>
              {connection.active ? "ativa" : "inativa"}
            </Badge>
          </HStack>
        </Card.Title>
        <Card.Description wordBreak="break-all">{connection.base_url}</Card.Description>
      </Card.Header>
      <Card.Body display="flex" flexDirection="column" gap="4">
        <SimpleGrid gap="3" columns={{ base: 1, sm: 2 }}>
          <Field.Root invalid={!!errors.name}>
            <Field.Label fontSize="xs">Nome</Field.Label>
            <Input
              disabled={!canConfigure}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Field.ErrorText>{errors.name}</Field.ErrorText>
          </Field.Root>
          <Field.Root invalid={!!errors.base_url}>
            <Field.Label fontSize="xs">URL base</Field.Label>
            <Input
              disabled={!canConfigure}
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            />
            <Field.ErrorText>{errors.base_url}</Field.ErrorText>
          </Field.Root>
          <Field.Root>
            <Field.Label fontSize="xs">Ambiente</Field.Label>
            <NativeSelect.Root disabled={!canConfigure}>
              <NativeSelect.Field
                value={form.environment}
                onChange={(e) => setForm({ ...form, environment: e.currentTarget.value })}
              >
                <option value="homologacao">Homologação</option>
                <option value="producao">Produção</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>
          <Field.Root>
            <Field.Label fontSize="xs">Tipo de autenticação</Field.Label>
            <NativeSelect.Root disabled={!canConfigure}>
              <NativeSelect.Field
                value={form.authentication_type}
                onChange={(e) => setForm({ ...form, authentication_type: e.currentTarget.value })}
              >
                {AUTH_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field.Root>

          {showsToken(form.authentication_type) ? (
            <Field.Root gridColumn={{ sm: "span 2" }}>
              <Field.Label fontSize="xs">Secret do token</Field.Label>
              <Input
                disabled={!canConfigure}
                value={form.token_secret_name}
                onChange={(e) => setForm({ ...form, token_secret_name: e.target.value })}
              />
            </Field.Root>
          ) : null}
          {showsApiKey(form.authentication_type) ? (
            <Field.Root gridColumn={{ sm: "span 2" }}>
              <Field.Label fontSize="xs">Secret da chave de API</Field.Label>
              <Input
                disabled={!canConfigure}
                value={form.api_key_secret_name}
                onChange={(e) => setForm({ ...form, api_key_secret_name: e.target.value })}
              />
            </Field.Root>
          ) : null}
          {showsClientPair(form.authentication_type) ? (
            <>
              <Field.Root>
                <Field.Label fontSize="xs">Secret do Client ID</Field.Label>
                <Input
                  disabled={!canConfigure}
                  value={form.client_id_secret_name}
                  onChange={(e) => setForm({ ...form, client_id_secret_name: e.target.value })}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label fontSize="xs">Secret do Client Secret</Field.Label>
                <Input
                  disabled={!canConfigure}
                  value={form.client_secret_secret_name}
                  onChange={(e) => setForm({ ...form, client_secret_secret_name: e.target.value })}
                />
              </Field.Root>
            </>
          ) : null}

          <Field.Root>
            <Field.Label fontSize="xs">Tempo limite (s)</Field.Label>
            <Input
              type="number"
              disabled={!canConfigure}
              value={form.timeout_seconds}
              onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value) })}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label fontSize="xs">Novas tentativas</Field.Label>
            <Input
              type="number"
              disabled={!canConfigure}
              value={form.retry_count}
              onChange={(e) => setForm({ ...form, retry_count: Number(e.target.value) })}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label fontSize="xs">Intervalo entre tentativas (ms)</Field.Label>
            <Input
              type="number"
              disabled={!canConfigure}
              value={form.retry_interval_ms}
              onChange={(e) => setForm({ ...form, retry_interval_ms: Number(e.target.value) })}
            />
          </Field.Root>
          <HStack gap="3" pt="6">
            <Switch.Root
              disabled={!canConfigure}
              checked={form.active}
              onCheckedChange={(e) => setForm({ ...form, active: e.checked })}
            >
              <Switch.HiddenInput />
              <Switch.Control />
            </Switch.Root>
            <Text fontSize="xs">Ativa</Text>
          </HStack>
        </SimpleGrid>

        {/* ETAPA 16 — webhook de retorno da Okton */}
        <Box borderWidth="1px" borderColor="border.subtle" rounded="l2" p="3">
          <Text fontSize="sm" fontWeight="medium">
            Webhook de retorno da Okton
          </Text>
          <Text mt="1" wordBreak="break-all" fontSize="xs" color="fg.muted">
            URL: {typeof window !== "undefined" ? window.location.origin : ""}
            /api/public/webhooks/okton/fiscal
          </Text>
          <SimpleGrid mt="3" gap="3" columns={{ base: 1, sm: 3 }}>
            <Field.Root>
              <Field.Label fontSize="xs">Modo de assinatura</Field.Label>
              <NativeSelect.Root disabled={!canConfigure}>
                <NativeSelect.Field
                  value={form.webhook_signature_mode}
                  onChange={(e) =>
                    setForm({ ...form, webhook_signature_mode: e.currentTarget.value })
                  }
                >
                  <option value="hmac_sha256">HMAC SHA-256</option>
                  <option value="token">Token no header</option>
                  <option value="none">Sem validação</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="xs">Header da assinatura</Field.Label>
              <Input
                disabled={!canConfigure}
                value={form.webhook_signature_header}
                onChange={(e) => setForm({ ...form, webhook_signature_header: e.target.value })}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="xs">Nome do secret</Field.Label>
              <Input
                disabled={!canConfigure}
                value={form.webhook_secret_name}
                onChange={(e) => setForm({ ...form, webhook_secret_name: e.target.value })}
              />
            </Field.Root>
          </SimpleGrid>
        </Box>

        <HStack flexWrap="wrap" gap="2">
          <Button size="sm" variant="subtle" onClick={onTest} disabled={testing}>
            <PlugZap /> {testing ? "Testando..." : "Testar conexão"}
          </Button>
          {canConfigure ? (
            <>
              <Button size="sm" onClick={submit}>
                <Save /> Salvar
              </Button>
              <Button size="sm" variant="outline" onClick={onSeed}>
                <RefreshCcw /> Sincronizar catálogo
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete}>
                <Trash2 />
              </Button>
            </>
          ) : null}
        </HStack>

        {shown ? (
          <Box
            borderWidth="1px"
            borderColor={shown.ok ? "border.brand" : "fg.danger"}
            bg={shown.ok ? "brand.subtle" : "bg.muted"}
            rounded="l2"
            p="3"
            fontSize="sm"
          >
            <Text fontWeight="medium">
              {shown.ok ? "Conexão realizada" : "Conexão não realizada"}
            </Text>
            <SimpleGrid
              as="dl"
              mt="2"
              gap="1"
              columns={{ base: 1, sm: 2 }}
              fontSize="xs"
              color="fg.muted"
            >
              <Box>Código HTTP: {shown.status || "—"}</Box>
              <Box>Tempo de resposta: {shown.durationMs ?? "—"} ms</Box>
              <Box gridColumn={{ sm: "span 2" }}>Mensagem: {shown.message ?? "—"}</Box>
              <Box gridColumn={{ sm: "span 2" }}>
                Data e hora do teste:{" "}
                {shown.testedAt ? new Date(shown.testedAt).toLocaleString("pt-BR") : "—"}
              </Box>
              {shown.credentialsConfigured === false ? (
                <Box gridColumn={{ sm: "span 2" }} color="fg.danger">
                  Credenciais ausentes no servidor — cadastre os secrets antes de testar.
                </Box>
              ) : null}
            </SimpleGrid>
          </Box>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

const endpointSchema = z.object({
  path: z.string().min(1, "Informe o caminho do endpoint"),
});

function EndpointRow({
  endpoint,
  canConfigure,
  onSaved,
}: {
  endpoint: Tables<"api_endpoints">;
  canConfigure: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    method: endpoint.method ?? "GET",
    path: endpoint.path ?? "",
    active: endpoint.active ?? true,
    headers: JSON.stringify(endpoint.headers ?? {}, null, 2),
    request_mapping: JSON.stringify(endpoint.request_mapping ?? {}, null, 2),
    response_mapping: JSON.stringify(endpoint.response_mapping ?? {}, null, 2),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    const parsed = endpointSchema.safeParse({ path: form.path });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Verifique os campos destacados");
      return;
    }
    setErrors({});
    let headers: unknown;
    let requestMapping: unknown;
    let responseMapping: unknown;
    try {
      headers = JSON.parse(form.headers || "{}");
      requestMapping = JSON.parse(form.request_mapping || "{}");
      responseMapping = JSON.parse(form.response_mapping || "{}");
    } catch {
      return toast.error("JSON inválido em cabeçalhos ou mapeamentos.");
    }
    const { error } = await supabase
      .from("api_endpoints")
      .update({
        method: form.method,
        path: form.path.trim(),
        active: form.active,
        headers: headers as never,
        request_mapping: requestMapping as never,
        response_mapping: responseMapping as never,
      })
      .eq("id", endpoint.id);
    if (error) return toast.error(error.message);
    toast.success("Endpoint salvo.");
    onSaved();
  };

  const remove = async () => {
    const { error } = await supabase.from("api_endpoints").delete().eq("id", endpoint.id);
    if (error) return toast.error(error.message);
    toast.success("Endpoint removido.");
    onSaved();
  };

  return (
    <Accordion.Item value={endpoint.id}>
      <Accordion.ItemTrigger gap="3">
        <HStack flex="1" flexWrap="wrap" gap="2" textAlign="left">
          <Badge variant="subtle">{endpoint.method}</Badge>
          <Text fontFamily="mono" fontSize="xs">
            {endpoint.key}
          </Text>
          <Text truncate fontFamily="mono" fontSize="xs" color="fg.muted">
            {endpoint.path}
          </Text>
          {!endpoint.active ? <Badge variant="outline">inativo</Badge> : null}
        </HStack>
        <Accordion.ItemIndicator />
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <Accordion.ItemBody display="flex" flexDirection="column" gap="3">
          {endpoint.description ? (
            <Text fontSize="xs" color="fg.muted">
              {endpoint.description}
            </Text>
          ) : null}
          <SimpleGrid gap="3" columns={{ base: 1, sm: 3 }}>
            <Field.Root>
              <Field.Label fontSize="xs">Método HTTP</Field.Label>
              <NativeSelect.Root disabled={!canConfigure}>
                <NativeSelect.Field
                  value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.currentTarget.value })}
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            <Field.Root gridColumn={{ sm: "span 2" }} invalid={!!errors.path}>
              <Field.Label fontSize="xs">Caminho</Field.Label>
              <Input
                disabled={!canConfigure}
                fontFamily="mono"
                fontSize="xs"
                value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
              />
              <Field.ErrorText>{errors.path}</Field.ErrorText>
            </Field.Root>
          </SimpleGrid>
          <HStack gap="3">
            <Switch.Root
              disabled={!canConfigure}
              checked={form.active}
              onCheckedChange={(e) => setForm({ ...form, active: e.checked })}
            >
              <Switch.HiddenInput />
              <Switch.Control />
            </Switch.Root>
            <Text fontSize="xs">Endpoint ativo</Text>
          </HStack>
          <SimpleGrid gap="3" columns={{ base: 1, lg: 3 }}>
            <Field.Root>
              <Field.Label fontSize="xs">Cabeçalhos adicionais (JSON)</Field.Label>
              <Textarea
                disabled={!canConfigure}
                rows={5}
                fontFamily="mono"
                fontSize="xs"
                value={form.headers}
                onChange={(e) => setForm({ ...form, headers: e.target.value })}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="xs">Mapeamento do request (JSON)</Field.Label>
              <Textarea
                disabled={!canConfigure}
                rows={5}
                fontFamily="mono"
                fontSize="xs"
                value={form.request_mapping}
                onChange={(e) => setForm({ ...form, request_mapping: e.target.value })}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="xs">Mapeamento do response (JSON)</Field.Label>
              <Textarea
                disabled={!canConfigure}
                rows={5}
                fontFamily="mono"
                fontSize="xs"
                value={form.response_mapping}
                onChange={(e) => setForm({ ...form, response_mapping: e.target.value })}
              />
            </Field.Root>
          </SimpleGrid>
          {canConfigure ? (
            <HStack gap="2">
              <Button size="sm" onClick={save}>
                <Save /> Salvar endpoint
              </Button>
              <Button size="sm" variant="ghost" onClick={remove}>
                <Trash2 /> Remover
              </Button>
            </HStack>
          ) : null}
        </Accordion.ItemBody>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}
