import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
  Link as CLink,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { toast } from "@/views/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { conversationAction, type ConversationAction } from "@/controllers/conversations.functions";

import { AppShell } from "@/views/components/AppShell";
import { AlertTriangle, Bot, Pause, Play, RotateCcw, Send, UserCheck, XCircle } from "lucide-react";

export const Route = createFileRoute("/conversas")({
  head: () => ({
    meta: [
      { title: "Conversas do WhatsApp | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Acompanhe o estado das conversas do funil de WhatsApp, o histórico completo e assuma o atendimento quando necessário.",
      },
      { property: "og:title", content: "Conversas | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Monitoramento e operação manual das conversas guiadas de emissão fiscal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConversationsPage,
});

const DOC_LABEL: Record<string, string> = { nfe: "NF-e", cte: "CT-e", mdfe: "MDF-e" };

const manualMessageSchema = z.object({
  text: z.string().trim().min(1, "Informe uma mensagem"),
});

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function StatusBadge({ status, paused }: { status: string; paused?: boolean }) {
  if (paused) return <Badge variant="outline">bot pausado</Badge>;
  const colorPalette =
    status === "cancelled" || status === "error" ? "red" : status === "human" ? "gray" : "green";
  const variant = status === "human" ? "outline" : "subtle";
  return (
    <Badge variant={variant} colorPalette={colorPalette}>
      {status}
    </Badge>
  );
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

function ConversationsPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const runAction = useServerFn(conversationAction);

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    refetchInterval: 10000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("last_interaction_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: users } = useQuery({
    queryKey: ["app-users-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_users").select("id, name, email");
      if (error) throw error;
      return data;
    },
  });

  const { data: steps } = useQuery({
    queryKey: ["flow-steps-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("flow_steps").select("id, name, key");
      if (error) throw error;
      return data;
    },
  });

  const userName = (id: string | null | undefined) =>
    users?.find((u) => u.id === id)?.name ?? (id ? "—" : "Bot");
  const stepName = (id: string | null | undefined) => steps?.find((s) => s.id === id)?.name ?? "—";

  const activeId = selected ?? conversations?.[0]?.id ?? null;
  const conversation = conversations?.find((c) => c.id === activeId) ?? null;

  const { data: messages } = useQuery({
    queryKey: ["messages", activeId],
    enabled: !!activeId,
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("received_at", { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: logs } = useQuery({
    queryKey: ["conversation-logs", activeId],
    enabled: !!activeId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_logs")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: draft } = useQuery({
    queryKey: ["conversation-draft", activeId],
    enabled: !!activeId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drafts")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: emissions } = useQuery({
    queryKey: ["conversation-emissions", activeId],
    enabled: !!activeId,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emissions")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: webhooks } = useQuery({
    queryKey: ["conversation-webhooks", activeId],
    enabled: !!activeId,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_events")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const relatedWebhooks = useMemo(() => {
    if (!conversation || !webhooks) return [];
    const needles = [
      conversation.id,
      conversation.phone_number,
      ...(emissions ?? []).flatMap((e) => [
        e.id,
        e.okton_document_id,
        e.access_key,
        e.idempotency_key,
      ]),
    ].filter(Boolean) as string[];
    return webhooks.filter((event) => {
      const raw = JSON.stringify(event.payload_json ?? {});
      return needles.some((needle) => raw.includes(needle));
    });
  }, [conversation, webhooks, emissions]);

  const hasError = (row: { last_error?: string | null; status: string }) =>
    Boolean(row.last_error) || row.status === "error";

  const collectedFields = (draft?.current_data_json ?? {}) as Record<string, unknown>;

  const mutation = useMutation({
    mutationFn: (vars: { action: ConversationAction; text?: string }) =>
      runAction({ data: { conversationId: activeId!, action: vars.action, text: vars.text } }),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setManual("");
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["messages", activeId] });
      queryClient.invalidateQueries({ queryKey: ["conversation-logs", activeId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const act = (action: ConversationAction, text?: string) => {
    if (!activeId) return;
    mutation.mutate({ action, text });
  };

  const busy = mutation.isPending;

  const submitManual = () => {
    const parsed = manualMessageSchema.safeParse({ text: manual });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Verifique os campos destacados");
      return;
    }
    setErrors({});
    act("send_manual_message", parsed.data.text);
  };

  return (
    <AppShell
      title="Conversas"
      description="Cada conversa mantém seu próprio estado no funil de emissão. Ações manuais são auditadas."
    >
      <SimpleGrid gap="4" columns={{ base: 1, xl: 2 }} templateColumns={{ xl: "420px 1fr" }}>
        <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
          <Card.Header>
            <Card.Title fontSize="md">Conversas recentes</Card.Title>
            <Card.Description>Atualiza automaticamente a cada 10s.</Card.Description>
          </Card.Header>
          <Card.Body>
            <Box maxH="640px" overflowY="auto" pr="3">
              <Stack gap="2">
                {(conversations ?? []).length === 0 ? (
                  <Text fontSize="sm" color="fg.muted">
                    Nenhuma conversa ainda.
                  </Text>
                ) : (
                  conversations?.map((row) => (
                    <Box
                      as="button"
                      key={row.id}
                      onClick={() => setSelected(row.id)}
                      w="full"
                      rounded="l2"
                      borderWidth="1px"
                      borderColor={activeId === row.id ? "border.brand" : "border"}
                      bg={activeId === row.id ? "bg.muted" : "transparent"}
                      _hover={{ bg: "bg.muted" }}
                      px="3"
                      py="2"
                      textAlign="left"
                      fontSize="sm"
                    >
                      <Flex align="center" justify="space-between" gap="2">
                        <Text fontFamily="mono" fontSize="xs">
                          {row.phone_number}
                        </Text>
                        <HStack gap="1">
                          {hasError(row as never) && (
                            <AlertTriangle
                              size={14}
                              color="var(--chakra-colors-fg-danger)"
                              aria-label="Erro"
                            />
                          )}
                          <StatusBadge
                            status={row.status}
                            paused={(row as { bot_paused?: boolean }).bot_paused}
                          />
                        </HStack>
                      </Flex>
                      <Text mt="1" truncate fontSize="xs" color="fg.muted">
                        {row.company_cnpj ?? "Empresa não identificada"}
                        {row.document_type
                          ? ` • ${DOC_LABEL[row.document_type] ?? row.document_type}`
                          : ""}
                      </Text>
                      <Text fontSize="11px" color="fg.muted">
                        Última interação: {fmt(row.last_interaction_at)}
                      </Text>
                    </Box>
                  ))
                )}
              </Stack>
            </Box>
          </Card.Body>
        </Card.Root>

        <Stack gap="4">
          {!conversation ? (
            <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
              <Card.Body py="10" textAlign="center" fontSize="sm" color="fg.muted">
                Selecione uma conversa para ver os detalhes.
              </Card.Body>
            </Card.Root>
          ) : (
            <>
              <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
                <Card.Header>
                  <Flex wrap="wrap" align="center" justify="space-between" gap="2">
                    <Box>
                      <Card.Title fontSize="md" fontFamily="mono">
                        {conversation.phone_number}
                      </Card.Title>
                      <Card.Description>
                        Início {fmt(conversation.started_at)} • Última interação{" "}
                        {fmt(conversation.last_interaction_at)}
                      </Card.Description>
                    </Box>
                    <HStack gap="2">
                      {hasError(conversation as never) && (
                        <Badge colorPalette="red">
                          <AlertTriangle size={12} /> erro
                        </Badge>
                      )}
                      <StatusBadge
                        status={conversation.status}
                        paused={(conversation as { bot_paused?: boolean }).bot_paused}
                      />
                    </HStack>
                  </Flex>
                </Card.Header>
                <Card.Body>
                  <Stack gap="4">
                    <SimpleGrid as="dl" gap="3" fontSize="sm" columns={{ base: 1, sm: 3 }}>
                      <Box>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          Empresa
                        </Text>
                        <Text as="dd">{conversation.company_cnpj ?? "—"}</Text>
                      </Box>
                      <Box>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          Filial
                        </Text>
                        <Text as="dd">{conversation.okton_branch_id ?? "—"}</Text>
                      </Box>
                      <Box>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          Documento
                        </Text>
                        <Text as="dd">
                          {conversation.document_type
                            ? (DOC_LABEL[conversation.document_type] ?? conversation.document_type)
                            : "—"}
                        </Text>
                      </Box>
                      <Box>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          Etapa atual
                        </Text>
                        <Text as="dd">{stepName(conversation.current_step_id)}</Text>
                      </Box>
                      <Box>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          Responsável
                        </Text>
                        <Text as="dd">
                          {userName(
                            (conversation as { assigned_app_user_id?: string | null })
                              .assigned_app_user_id,
                          )}
                        </Text>
                      </Box>
                      <Box>
                        <Text as="dt" fontSize="xs" color="fg.muted">
                          Último erro
                        </Text>
                        <Text as="dd" color="fg.danger">
                          {(conversation as { last_error?: string | null }).last_error ?? "—"}
                        </Text>
                      </Box>
                    </SimpleGrid>

                    <HStack gap="2" wrap="wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act("pause_bot")}
                      >
                        <Pause size={14} /> Pausar bot
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act("resume_bot")}
                      >
                        <Play size={14} /> Retomar bot
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act("take_over")}
                      >
                        <UserCheck size={14} /> Assumir atendimento
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act("return_to_bot")}
                      >
                        <Bot size={14} /> Voltar para o bot
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act("reprocess_last")}
                      >
                        <RotateCcw size={14} /> Reprocessar última ação
                      </Button>
                      <Button
                        size="sm"
                        colorPalette="red"
                        disabled={busy}
                        onClick={() => act("cancel_conversation")}
                      >
                        <XCircle size={14} /> Cancelar conversa
                      </Button>
                    </HStack>

                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitManual();
                      }}
                    >
                      <HStack gap="2" align="start">
                        <Field.Root invalid={!!errors.text} flex="1">
                          <Input
                            value={manual}
                            onChange={(event) => setManual(event.target.value)}
                            placeholder="Enviar mensagem manual ao cliente..."
                            aria-label="Mensagem manual"
                          />
                          {errors.text ? <Field.ErrorText>{errors.text}</Field.ErrorText> : null}
                        </Field.Root>
                        <Button type="submit" size="sm" disabled={busy || !manual.trim()}>
                          <Send size={14} /> Enviar
                        </Button>
                      </HStack>
                    </form>
                  </Stack>
                </Card.Body>
              </Card.Root>

              <Card.Root shadow="panel" borderColor="border" bg="bg.panel">
                <Card.Body pt="6">
                  <Tabs.Root defaultValue="historico">
                    <Tabs.List flexWrap="wrap">
                      <Tabs.Trigger value="historico">Histórico</Tabs.Trigger>
                      <Tabs.Trigger value="okton">Chamadas Okton</Tabs.Trigger>
                      <Tabs.Trigger value="campos">Campos e validações</Tabs.Trigger>
                      <Tabs.Trigger value="rascunho">Rascunho</Tabs.Trigger>
                      <Tabs.Trigger value="emissao">Emissão</Tabs.Trigger>
                      <Tabs.Trigger value="webhooks">Webhooks</Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="historico">
                      <Box maxH="460px" overflowY="auto" pr="3">
                        <Stack gap="3">
                          {(messages ?? []).length === 0 ? (
                            <Text fontSize="sm" color="fg.muted">
                              Sem mensagens nesta conversa.
                            </Text>
                          ) : (
                            messages?.map((message) => (
                              <Box
                                key={message.id}
                                maxW="80%"
                                rounded="l2"
                                px="3"
                                py="2"
                                fontSize="sm"
                                ml={message.direction === "inbound" ? undefined : "auto"}
                                bg={message.direction === "inbound" ? "bg.muted" : "brand.subtle"}
                              >
                                <Text
                                  fontSize="10px"
                                  textTransform="uppercase"
                                  letterSpacing="wide"
                                  color="fg.muted"
                                >
                                  {message.direction === "inbound" ? "Cliente" : "Bot / Operador"}
                                </Text>
                                <Text whiteSpace="pre-wrap">{message.content}</Text>
                                <Text mt="1" fontSize="10px" color="fg.muted">
                                  {fmt(message.received_at ?? message.sent_at)}
                                </Text>
                              </Box>
                            ))
                          )}
                        </Stack>
                      </Box>
                    </Tabs.Content>

                    <Tabs.Content value="okton">
                      <Box maxH="460px" overflowY="auto" pr="3">
                        <Stack gap="2">
                          {(logs ?? []).length === 0 ? (
                            <Text fontSize="sm" color="fg.muted">
                              Nenhuma chamada registrada.
                            </Text>
                          ) : (
                            logs?.map((log) => (
                              <Box
                                as="details"
                                key={log.id}
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
                                    {log.method ?? "—"} {log.endpoint ?? log.service}
                                  </Text>
                                  <HStack gap="2">
                                    <Badge
                                      colorPalette={log.success ? "green" : "red"}
                                      variant="subtle"
                                    >
                                      {log.status_code ?? (log.success ? "ok" : "erro")}
                                    </Badge>
                                    <Text fontSize="11px" color="fg.muted">
                                      {log.duration_ms ?? 0} ms
                                    </Text>
                                  </HStack>
                                </Box>
                                <Text mt="2" fontSize="11px" color="fg.muted">
                                  {fmt(log.created_at)}
                                </Text>
                                {log.error_message && (
                                  <Text fontSize="xs" color="fg.danger">
                                    {log.error_message}
                                  </Text>
                                )}
                                <JsonBlock value={log.request_summary_json} />
                                <JsonBlock value={log.response_summary_json} />
                              </Box>
                            ))
                          )}
                        </Stack>
                      </Box>
                    </Tabs.Content>

                    <Tabs.Content value="campos">
                      <Box maxH="460px" overflowY="auto" pr="3">
                        {Object.keys(collectedFields).length === 0 ? (
                          <Text fontSize="sm" color="fg.muted">
                            Nenhum campo coletado.
                          </Text>
                        ) : (
                          <Table.Root size="sm">
                            <Table.Header>
                              <Table.Row>
                                <Table.ColumnHeader>Campo</Table.ColumnHeader>
                                <Table.ColumnHeader>Valor</Table.ColumnHeader>
                              </Table.Row>
                            </Table.Header>
                            <Table.Body>
                              {Object.entries(collectedFields).map(([key, value]) => (
                                <Table.Row key={key}>
                                  <Table.Cell fontFamily="mono" fontSize="xs">
                                    {key}
                                  </Table.Cell>
                                  <Table.Cell>
                                    {typeof value === "object"
                                      ? JSON.stringify(value)
                                      : String(value)}
                                  </Table.Cell>
                                </Table.Row>
                              ))}
                            </Table.Body>
                          </Table.Root>
                        )}
                        <Box mt="4">
                          <Text mb="1" fontSize="xs" color="fg.muted">
                            Validações / estado interno
                          </Text>
                          <JsonBlock value={draft?.validation_result_json} />
                        </Box>
                      </Box>
                    </Tabs.Content>

                    <Tabs.Content value="rascunho">
                      {!draft ? (
                        <Text fontSize="sm" color="fg.muted">
                          Nenhum rascunho ativo.
                        </Text>
                      ) : (
                        <Stack gap="2" fontSize="sm">
                          <HStack gap="2" wrap="wrap">
                            <Badge variant="subtle" colorPalette="green">
                              {draft.status}
                            </Badge>
                            <Text fontSize="xs" color="fg.muted">
                              {DOC_LABEL[draft.document_type] ?? draft.document_type} • criado{" "}
                              {fmt(draft.created_at)} • expira {fmt(draft.expires_at)}
                            </Text>
                          </HStack>
                          <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                            Okton draft: {draft.okton_draft_id ?? "—"}
                          </Text>
                          <JsonBlock value={draft.current_data_json} />
                        </Stack>
                      )}
                    </Tabs.Content>

                    <Tabs.Content value="emissao">
                      <Box maxH="460px" overflowY="auto" pr="3">
                        {(emissions ?? []).length === 0 ? (
                          <Text fontSize="sm" color="fg.muted">
                            Nenhuma emissão para esta conversa.
                          </Text>
                        ) : (
                          <Stack gap="3">
                            {emissions?.map((emission) => (
                              <Box
                                key={emission.id}
                                rounded="l2"
                                borderWidth="1px"
                                borderColor="border"
                                p="3"
                                fontSize="sm"
                              >
                                <Flex wrap="wrap" align="center" justify="space-between" gap="2">
                                  <Badge
                                    variant={
                                      emission.status === "authorized"
                                        ? "subtle"
                                        : ["rejected", "error"].includes(emission.status)
                                          ? "solid"
                                          : "outline"
                                    }
                                    colorPalette={
                                      emission.status === "authorized"
                                        ? "green"
                                        : ["rejected", "error"].includes(emission.status)
                                          ? "red"
                                          : "gray"
                                    }
                                  >
                                    {emission.status}
                                  </Badge>
                                  <Text fontSize="xs" color="fg.muted">
                                    {fmt(emission.updated_at)}
                                  </Text>
                                </Flex>
                                <Text mt="2" fontFamily="mono" fontSize="xs">
                                  Chave: {emission.access_key ?? "—"} • Protocolo:{" "}
                                  {emission.protocol ?? "—"}
                                </Text>
                                <HStack mt="1" gap="3" fontSize="xs">
                                  {emission.pdf_url && (
                                    <CLink
                                      href={emission.pdf_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      textDecoration="underline"
                                    >
                                      DANFE
                                    </CLink>
                                  )}
                                  {emission.xml_url && (
                                    <CLink
                                      href={emission.xml_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      textDecoration="underline"
                                    >
                                      XML
                                    </CLink>
                                  )}
                                </HStack>
                                {emission.rejection ? (
                                  <JsonBlock value={emission.rejection} />
                                ) : null}
                              </Box>
                            ))}
                          </Stack>
                        )}
                      </Box>
                    </Tabs.Content>

                    <Tabs.Content value="webhooks">
                      <Box maxH="460px" overflowY="auto" pr="3">
                        {relatedWebhooks.length === 0 ? (
                          <Text fontSize="sm" color="fg.muted">
                            Nenhum webhook relacionado.
                          </Text>
                        ) : (
                          <Stack gap="2">
                            {relatedWebhooks.map((event) => (
                              <Box
                                as="details"
                                key={event.id}
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
                                    {event.provider} • {event.event_type ?? "evento"}
                                  </Text>
                                  <Badge
                                    variant="subtle"
                                    colorPalette={
                                      event.processing_status === "failed" ? "red" : "green"
                                    }
                                  >
                                    {event.processing_status}
                                  </Badge>
                                </Box>
                                <Text mt="2" fontSize="11px" color="fg.muted">
                                  {fmt(event.received_at)}
                                </Text>
                                <JsonBlock value={event.payload_json} />
                              </Box>
                            ))}
                          </Stack>
                        )}
                      </Box>
                    </Tabs.Content>
                  </Tabs.Root>
                </Card.Body>
              </Card.Root>
            </>
          )}
        </Stack>
      </SimpleGrid>
    </AppShell>
  );
}
