import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  Flex,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { toast } from "@/views/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import {
  simulatorChangeState,
  simulatorLoad,
  simulatorResetConversation,
  simulatorSendMessage,
  simulatorSendWebhook,
} from "@/controllers/simulator.functions";
import type { SimulatorSnapshot } from "@/controllers/simulator.functions";
import { AppShell } from "@/views/components/AppShell";
import { CheckCircle2, RotateCcw, Send, TimerOff, Webhook, XOctagon } from "lucide-react";

export const Route = createFileRoute("/simulador")({
  head: () => ({
    meta: [
      { title: "Simulador de WhatsApp | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Teste o funil fiscal completo sem número real: envie mensagens, inspecione o rascunho e simule retornos da Okton.",
      },
      { property: "og:title", content: "Simulador | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Ambiente de testes que usa o mesmo motor de conversa do webhook real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SimulatorPage,
});

const STATUS_OPTIONS = [
  "awaiting_cnpj",
  "confirming_company",
  "company_not_found",
  "selecting_branch",
  "choosing_flow",
  "active",
  "human",
  "cancelled",
];

const EMPTY: SimulatorSnapshot = {
  conversation: null,
  messages: [],
  draft: null,
  emissions: [],
  logs: [],
  webhooks: [],
};

const messageSchema = z.object({ text: z.string().trim().min(1, "Informe uma mensagem") });

const customPayloadSchema = z.object({
  customPayload: z
    .string()
    .trim()
    .min(1, "Informe o payload")
    .refine((value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    }, "JSON inválido"),
});

function fmt(value: unknown) {
  if (typeof value !== "string") return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <Box
      as="pre"
      overflowX="auto"
      rounded="l2"
      bg="bg.muted"
      p="3"
      fontSize="11px"
      lineHeight="relaxed"
    >
      {JSON.stringify(value ?? {}, null, 2)}
    </Box>
  );
}

function SimulatorPage() {
  const [organizationId, setOrganizationId] = useState<string>("");
  const [connectionId, setConnectionId] = useState<string>("");
  const [phone, setPhone] = useState("5511999990000");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | undefined>();
  const [status, setStatus] = useState<string>("");
  const [stepId, setStepId] = useState<string>("");
  const [customPayload, setCustomPayload] = useState("");
  const [payloadError, setPayloadError] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<SimulatorSnapshot>(EMPTY);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const send = useServerFn(simulatorSendMessage);
  const load = useServerFn(simulatorLoad);
  const reset = useServerFn(simulatorResetConversation);
  const changeState = useServerFn(simulatorChangeState);
  const sendWebhook = useServerFn(simulatorSendWebhook);

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: connections } = useQuery({
    queryKey: ["api-connections-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_connections")
        .select("id, name, environment, active, organization_id")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: steps } = useQuery({
    queryKey: ["flow-steps-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("flow_steps").select("id, name, key, flow_id");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!organizationId && organizations?.[0]) setOrganizationId(organizations[0].id);
  }, [organizations, organizationId]);

  const orgConnections = useMemo(
    () =>
      (connections ?? []).filter((c) => !organizationId || c.organization_id === organizationId),
    [connections, organizationId],
  );

  useEffect(() => {
    if (!connectionId && orgConnections[0]) setConnectionId(orgConnections[0].id);
  }, [orgConnections, connectionId]);

  const applyResult = (result: {
    ok: boolean;
    message: string;
    snapshot: SimulatorSnapshot | null;
  }) => {
    if (result.snapshot) setSnapshot(result.snapshot);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };

  const refresh = useMutation({
    mutationFn: () => load({ data: { organizationId, phone } }),
    onSuccess: (data) => setSnapshot(data),
    onError: (error: Error) => toast.error(error.message),
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) => send({ data: { organizationId, phone, text: message } }),
    onSuccess: (result) => {
      applyResult(result);
      setText("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetMutation = useMutation({
    mutationFn: () => reset({ data: { organizationId, phone } }),
    onSuccess: applyResult,
    onError: (error: Error) => toast.error(error.message),
  });

  const stateMutation = useMutation({
    mutationFn: () =>
      changeState({
        data: {
          organizationId,
          phone,
          ...(status ? { status } : {}),
          ...(stepId ? { stepId } : {}),
        },
      }),
    onSuccess: applyResult,
    onError: (error: Error) => toast.error(error.message),
  });

  const webhookMutation = useMutation({
    mutationFn: (kind: "authorized" | "rejected" | "timeout" | "custom") =>
      sendWebhook({ data: { organizationId, phone, kind, customPayload } }),
    onSuccess: applyResult,
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snapshot.messages.length]);

  const busy =
    sendMutation.isPending ||
    resetMutation.isPending ||
    stateMutation.isPending ||
    webhookMutation.isPending ||
    refresh.isPending;

  const conversation = snapshot.conversation;

  const submitMessage = () => {
    const parsed = messageSchema.safeParse({ text });
    if (!parsed.success) {
      setTextError(parsed.error.issues[0]?.message);
      toast.error("Verifique os campos destacados");
      return;
    }
    setTextError(undefined);
    sendMutation.mutate(parsed.data.text);
  };

  const submitCustomWebhook = () => {
    const parsed = customPayloadSchema.safeParse({ customPayload });
    if (!parsed.success) {
      setPayloadError(parsed.error.issues[0]?.message);
      toast.error("Verifique os campos destacados");
      return;
    }
    setPayloadError(undefined);
    webhookMutation.mutate("custom");
  };

  return (
    <AppShell
      title="Simulador"
      description="Testa o funil completo sem número real — usa exatamente o mesmo motor de conversa do webhook."
    >
      <Flex direction={{ base: "column", xl: "row" }} gap="4">
        <Stack gap="4" flex={{ xl: "0 0 400px" }}>
          <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
            <Card.Header>
              <Card.Title fontSize="md">Ambiente simulado</Card.Title>
              <Card.Description>Nada é enviado para o WhatsApp real.</Card.Description>
            </Card.Header>
            <Card.Body>
              <Stack gap="3">
                <Field.Root>
                  <Field.Label>Organização</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={organizationId}
                      onChange={(event) => setOrganizationId(event.currentTarget.value)}
                    >
                      <option value="" disabled>
                        Selecione
                      </option>
                      {(organizations ?? []).map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>

                <Field.Root>
                  <Field.Label>Conexão Okton</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={connectionId}
                      onChange={(event) => setConnectionId(event.currentTarget.value)}
                    >
                      <option value="" disabled>
                        Selecione
                      </option>
                      {orgConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.name} · {connection.environment}
                          {connection.active ? "" : " (inativa)"}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                  <Text fontSize="11px" color="fg.muted">
                    As chamadas usam a conexão ativa da organização, como em produção.
                  </Text>
                </Field.Root>

                <Field.Root>
                  <Field.Label htmlFor="phone">Telefone fictício</Field.Label>
                  <Input
                    id="phone"
                    value={phone}
                    maxLength={20}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="5511999990000"
                  />
                </Field.Root>

                <HStack gap="2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !phone}
                    onClick={() => refresh.mutate()}
                  >
                    Atualizar
                  </Button>
                  <Button
                    colorPalette="red"
                    size="sm"
                    disabled={busy || !phone}
                    onClick={() => resetMutation.mutate()}
                  >
                    <RotateCcw size={14} /> Reiniciar conversa
                  </Button>
                </HStack>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
            <Card.Header>
              <Card.Title fontSize="md">Estado atual</Card.Title>
              <Card.Description>
                {conversation
                  ? `Status: ${String(conversation["status"])} · última interação ${fmt(conversation["last_interaction_at"])}`
                  : "Nenhuma conversa criada ainda."}
              </Card.Description>
            </Card.Header>
            <Card.Body>
              <Stack gap="3">
                <Field.Root>
                  <Field.Label>Alterar status</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={status}
                      onChange={(event) => setStatus(event.currentTarget.value)}
                    >
                      <option value="">Selecione um status</option>
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Etapa atual</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={stepId}
                      onChange={(event) => setStepId(event.currentTarget.value)}
                    >
                      <option value="">Manter etapa</option>
                      {(steps ?? []).map((step) => (
                        <option key={step.id} value={step.id}>
                          {step.name}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
                <Button
                  size="sm"
                  disabled={busy || !conversation}
                  onClick={() => stateMutation.mutate()}
                >
                  Aplicar estado
                </Button>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
            <Card.Header>
              <Card.Title fontSize="md">Retorno da Okton</Card.Title>
              <Card.Description>Dispara o mesmo processador do webhook real.</Card.Description>
            </Card.Header>
            <Card.Body>
              <Stack gap="3">
                <HStack gap="2" wrap="wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => webhookMutation.mutate("authorized")}
                  >
                    <CheckCircle2 size={14} /> Autorização
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => webhookMutation.mutate("rejected")}
                  >
                    <XOctagon size={14} /> Rejeição
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => webhookMutation.mutate("timeout")}
                  >
                    <TimerOff size={14} /> Timeout
                  </Button>
                </HStack>
                <Field.Root invalid={!!payloadError}>
                  <Field.Label htmlFor="payload">Payload personalizado (JSON)</Field.Label>
                  <Textarea
                    id="payload"
                    rows={5}
                    value={customPayload}
                    onChange={(event) => setCustomPayload(event.target.value)}
                    placeholder='{"event":"document_authorized","request_id":"..."}'
                    fontFamily="mono"
                    fontSize="xs"
                  />
                  {payloadError ? <Field.ErrorText>{payloadError}</Field.ErrorText> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    mt="2"
                    disabled={busy || !customPayload.trim()}
                    onClick={submitCustomWebhook}
                  >
                    <Webhook size={14} /> Enviar webhook
                  </Button>
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>
        </Stack>

        <Stack gap="4" flex="1" minW="0">
          <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
            <Card.Header>
              <Flex align="center" justify="space-between" gap="2">
                <Card.Title fontSize="md">Conversa simulada</Card.Title>
                {conversation ? (
                  <Badge variant="subtle" colorPalette="green">
                    {String(conversation["status"])}
                  </Badge>
                ) : null}
              </Flex>
            </Card.Header>
            <Card.Body>
              <Stack gap="3">
                <Box
                  maxH="420px"
                  overflowY="auto"
                  rounded="l2"
                  borderWidth="1px"
                  borderColor="border"
                  bg="bg.muted"
                  p="3"
                >
                  <Stack gap="3">
                    {snapshot.messages.length === 0 ? (
                      <Text fontSize="sm" color="fg.muted">
                        Envie a primeira mensagem para iniciar o atendimento simulado.
                      </Text>
                    ) : (
                      snapshot.messages.map((message) => (
                        <Box
                          key={String(message["id"])}
                          maxW="80%"
                          rounded="l2"
                          px="3"
                          py="2"
                          fontSize="sm"
                          ml={message["direction"] === "inbound" ? undefined : "auto"}
                          bg={message["direction"] === "inbound" ? "bg" : "brand.subtle"}
                        >
                          <Text whiteSpace="pre-wrap">{String(message["content"] ?? "")}</Text>
                          <Text mt="1" fontSize="10px" color="fg.muted">
                            {fmt(message["received_at"] ?? message["sent_at"])}
                          </Text>
                        </Box>
                      ))
                    )}
                    <div ref={bottomRef} />
                  </Stack>
                </Box>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitMessage();
                  }}
                >
                  <HStack gap="2" align="start">
                    <Field.Root invalid={!!textError} flex="1">
                      <Input
                        value={text}
                        maxLength={1000}
                        onChange={(event) => setText(event.target.value)}
                        placeholder="Digite como se fosse o cliente no WhatsApp..."
                        aria-label="Mensagem do cliente simulado"
                      />
                      {textError ? <Field.ErrorText>{textError}</Field.ErrorText> : null}
                    </Field.Root>
                    <Button type="submit" disabled={busy || !text.trim() || !phone}>
                      <Send size={14} /> Enviar
                    </Button>
                  </HStack>
                </form>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
            <Card.Body pt="6">
              <Tabs.Root defaultValue="rascunho">
                <Tabs.List flexWrap="wrap">
                  <Tabs.Trigger value="rascunho">Rascunho</Tabs.Trigger>
                  <Tabs.Trigger value="chamadas">Requests / Responses</Tabs.Trigger>
                  <Tabs.Trigger value="emissoes">Emissões</Tabs.Trigger>
                  <Tabs.Trigger value="webhooks">Webhooks</Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="rascunho">
                  {!snapshot.draft ? (
                    <Text fontSize="sm" color="fg.muted">
                      Nenhum rascunho ativo.
                    </Text>
                  ) : (
                    <Stack gap="2" fontSize="sm">
                      <HStack gap="2" wrap="wrap">
                        <Badge variant="subtle" colorPalette="green">
                          {String(snapshot.draft["status"])}
                        </Badge>
                        <Badge variant="outline">{String(snapshot.draft["document_type"])}</Badge>
                      </HStack>
                      <Text fontSize="xs" color="fg.muted">
                        Campos coletados
                      </Text>
                      <JsonBlock value={snapshot.draft["current_data_json"]} />
                      <Text fontSize="xs" color="fg.muted">
                        Estado interno / validações
                      </Text>
                      <JsonBlock value={snapshot.draft["validation_result_json"]} />
                    </Stack>
                  )}
                </Tabs.Content>

                <Tabs.Content value="chamadas">
                  <Box maxH="380px" overflowY="auto" pr="3">
                    {snapshot.logs.length === 0 ? (
                      <Text fontSize="sm" color="fg.muted">
                        Nenhuma chamada registrada.
                      </Text>
                    ) : (
                      <Stack gap="2">
                        {snapshot.logs.map((log) => (
                          <Box
                            as="details"
                            key={String(log["id"])}
                            rounded="l2"
                            borderWidth="1px"
                            borderColor="border"
                            p="3"
                            fontSize="sm"
                          >
                            <Box
                              as="summary"
                              cursor="pointer"
                              display="flex"
                              alignItems="center"
                              justifyContent="space-between"
                              gap="2"
                            >
                              <Text fontFamily="mono" fontSize="xs">
                                {String(log["method"] ?? "—")}{" "}
                                {String(log["endpoint"] ?? log["service"])}
                              </Text>
                              <HStack gap="2">
                                <Badge
                                  variant="subtle"
                                  colorPalette={log["success"] ? "green" : "red"}
                                >
                                  {String(log["status_code"] ?? (log["success"] ? "ok" : "erro"))}
                                </Badge>
                                <Text fontSize="11px" color="fg.muted">
                                  {String(log["duration_ms"] ?? 0)} ms
                                </Text>
                              </HStack>
                            </Box>
                            <Text mt="2" fontSize="11px" color="fg.muted">
                              {fmt(log["created_at"])}
                            </Text>
                            <Text fontSize="xs" color="fg.muted">
                              Request
                            </Text>
                            <JsonBlock value={log["request_summary_json"]} />
                            <Text fontSize="xs" color="fg.muted">
                              Response
                            </Text>
                            <JsonBlock value={log["response_summary_json"]} />
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Tabs.Content>

                <Tabs.Content value="emissoes">
                  {snapshot.emissions.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                      Nenhuma emissão nesta simulação.
                    </Text>
                  ) : (
                    <Stack gap="2">
                      {snapshot.emissions.map((emission) => (
                        <Box
                          key={String(emission["id"])}
                          rounded="l2"
                          borderWidth="1px"
                          borderColor="border"
                          p="3"
                          fontSize="sm"
                        >
                          <Badge
                            variant={emission["status"] === "authorized" ? "subtle" : "outline"}
                            colorPalette={
                              emission["status"] === "authorized"
                                ? "green"
                                : ["rejected", "error"].includes(String(emission["status"]))
                                  ? "red"
                                  : "gray"
                            }
                          >
                            {String(emission["status"])}
                          </Badge>
                          <Text mt="2" fontFamily="mono" fontSize="xs">
                            Chave: {String(emission["access_key"] ?? "—")} · Protocolo:{" "}
                            {String(emission["protocol"] ?? "—")}
                          </Text>
                          {emission["rejection"] ? (
                            <JsonBlock value={emission["rejection"]} />
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Tabs.Content>

                <Tabs.Content value="webhooks">
                  <Box maxH="380px" overflowY="auto" pr="3">
                    {snapshot.webhooks.length === 0 ? (
                      <Text fontSize="sm" color="fg.muted">
                        Nenhum evento da Okton.
                      </Text>
                    ) : (
                      <Stack gap="2">
                        {snapshot.webhooks.map((event) => (
                          <Box
                            as="details"
                            key={String(event["id"])}
                            rounded="l2"
                            borderWidth="1px"
                            borderColor="border"
                            p="3"
                            fontSize="sm"
                          >
                            <Box
                              as="summary"
                              cursor="pointer"
                              display="flex"
                              alignItems="center"
                              justifyContent="space-between"
                              gap="2"
                            >
                              <Text fontFamily="mono" fontSize="xs">
                                {String(event["event_type"] ?? "evento")}
                              </Text>
                              <Badge
                                variant="subtle"
                                colorPalette={
                                  event["processing_status"] === "failed" ? "red" : "green"
                                }
                              >
                                {String(event["processing_status"])}
                              </Badge>
                            </Box>
                            <Text mt="2" fontSize="11px" color="fg.muted">
                              {fmt(event["received_at"])}
                            </Text>
                            <JsonBlock value={event["payload_json"]} />
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Tabs.Content>
              </Tabs.Root>
            </Card.Body>
          </Card.Root>
        </Stack>
      </Flex>
    </AppShell>
  );
}
