import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  Grid,
  HStack,
  Input,
  NativeSelect,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/views/hooks/useAuth";
import { AppShell } from "@/views/components/AppShell";
import { maskPhone } from "@/models/masking";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/logs")({
  head: () => ({
    meta: [
      { title: "Logs e segurança | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Consulte chamadas à Okton, webhooks e auditoria com dados sensíveis mascarados e filtros por data, serviço, status e requisição.",
      },
      { property: "og:title", content: "Logs e segurança | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Rastreabilidade completa com mascaramento de tokens, CPF/CNPJ e telefones.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LogsPage,
});

const ALL = "__all__";

type Filters = {
  from: string;
  to: string;
  organizationId: string;
  conversationId: string;
  documentType: string;
  service: string;
  endpoint: string;
  statusCode: string;
  outcome: string;
  requestId: string;
  phone: string;
  oktonCompanyId: string;
  environment: string;
};

const EMPTY_FILTERS: Filters = {
  from: "",
  to: "",
  organizationId: ALL,
  conversationId: ALL,
  documentType: ALL,
  service: ALL,
  endpoint: "",
  statusCode: "",
  outcome: ALL,
  requestId: "",
  phone: "",
  oktonCompanyId: "",
  environment: ALL,
};

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function LogsPage() {
  const { canAudit, loading } = useAuth();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id,name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: conversations } = useQuery({
    queryKey: ["conversations-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id,phone_number,document_type")
        .order("last_interaction_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: logs, isFetching } = useQuery({
    queryKey: ["integration_logs", filters],
    refetchInterval: 20000,
    queryFn: async () => {
      let query = supabase
        .from("integration_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);

      if (filters.from) query = query.gte("created_at", new Date(filters.from).toISOString());
      if (filters.to)
        query = query.lte("created_at", new Date(`${filters.to}T23:59:59`).toISOString());
      if (filters.organizationId !== ALL)
        query = query.eq("organization_id", filters.organizationId);
      if (filters.conversationId !== ALL)
        query = query.eq("conversation_id", filters.conversationId);
      if (filters.documentType !== ALL)
        query = query.eq("document_type", filters.documentType as "nfe" | "cte" | "mdfe");
      if (filters.service !== ALL) query = query.eq("service", filters.service);
      if (filters.environment !== ALL) query = query.eq("environment", filters.environment);
      if (filters.endpoint.trim()) query = query.ilike("endpoint", `%${filters.endpoint.trim()}%`);
      if (filters.statusCode.trim()) query = query.eq("status_code", Number(filters.statusCode));
      if (filters.outcome !== ALL) query = query.eq("success", filters.outcome === "sucesso");
      if (filters.requestId.trim()) query = query.eq("request_id", filters.requestId.trim());
      if (filters.oktonCompanyId.trim())
        query = query.ilike("okton_company_id", `%${filters.oktonCompanyId.trim()}%`);
      if (filters.phone.trim())
        query = query.ilike("phone_masked", `%${maskPhone(filters.phone.trim()).slice(-5)}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: audit } = useQuery({
    queryKey: ["audit_logs", filters.organizationId, filters.from, filters.to],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filters.organizationId !== ALL)
        query = query.eq("organization_id", filters.organizationId);
      if (filters.from) query = query.gte("created_at", new Date(filters.from).toISOString());
      if (filters.to)
        query = query.lte("created_at", new Date(`${filters.to}T23:59:59`).toISOString());
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const services = useMemo(() => {
    const list = new Set(["okton", "whatsapp", "webhook", "painel"]);
    (logs ?? []).forEach((log) => list.add(log.service));
    return [...list];
  }, [logs]);

  if (!loading && !canAudit) {
    return (
      <AppShell title="Logs e segurança" description="Acesso restrito.">
        <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
          <Card.Body
            display="flex"
            alignItems="center"
            gap="3"
            py="10"
            fontSize="sm"
            color="fg.muted"
          >
            <ShieldCheck size={20} />
            Seu perfil não tem permissão para consultar logs. Fale com um administrador.
          </Card.Body>
        </Card.Root>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Logs e segurança"
      description="Tokens, secrets, certificados e dados de cartão nunca são gravados; CPF/CNPJ e telefones aparecem mascarados."
    >
      <Stack gap="4">
        <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
          <Card.Header>
            <Card.Title fontSize="base">Filtros</Card.Title>
            <Card.Description>
              Combine período, origem e identificadores para localizar uma requisição específica.
            </Card.Description>
          </Card.Header>
          <Card.Body>
            <Grid
              gap="3"
              templateColumns={{ base: "1fr", md: "repeat(3, 1fr)", xl: "repeat(4, 1fr)" }}
            >
              <Field.Root>
                <Field.Label>Data inicial</Field.Label>
                <Input
                  type="date"
                  value={draft.from}
                  onChange={(e) => set("from", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Data final</Field.Label>
                <Input type="date" value={draft.to} onChange={(e) => set("to", e.target.value)} />
              </Field.Root>
              <Field.Root>
                <Field.Label>Organização</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={draft.organizationId}
                    onChange={(e) => set("organizationId", e.currentTarget.value)}
                  >
                    <option value={ALL}>Todas</option>
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
                <Field.Label>Conversa</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={draft.conversationId}
                    onChange={(e) => set("conversationId", e.currentTarget.value)}
                  >
                    <option value={ALL}>Todas</option>
                    {(conversations ?? []).map((conversation) => (
                      <option key={conversation.id} value={conversation.id}>
                        {maskPhone(conversation.phone_number)}
                        {conversation.document_type ? ` · ${conversation.document_type}` : ""}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Documento</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={draft.documentType}
                    onChange={(e) => set("documentType", e.currentTarget.value)}
                  >
                    <option value={ALL}>Todos</option>
                    <option value="nfe">NF-e</option>
                    <option value="cte">CT-e</option>
                    <option value="mdfe">MDF-e</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Serviço</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={draft.service}
                    onChange={(e) => set("service", e.currentTarget.value)}
                  >
                    <option value={ALL}>Todos</option>
                    {services.map((service) => (
                      <option key={service} value={service}>
                        {service}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Endpoint</Field.Label>
                <Input
                  value={draft.endpoint}
                  maxLength={120}
                  placeholder="/api/bot/..."
                  onChange={(e) => set("endpoint", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Status HTTP</Field.Label>
                <Input
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="200"
                  value={draft.statusCode}
                  onChange={(e) => set("statusCode", e.target.value.replace(/\D/g, ""))}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Resultado</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={draft.outcome}
                    onChange={(e) => set("outcome", e.currentTarget.value)}
                  >
                    <option value={ALL}>Todos</option>
                    <option value="sucesso">Sucesso</option>
                    <option value="erro">Erro</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Ambiente</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={draft.environment}
                    onChange={(e) => set("environment", e.currentTarget.value)}
                  >
                    <option value={ALL}>Todos</option>
                    <option value="homologacao">Homologação</option>
                    <option value="producao">Produção</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Request ID</Field.Label>
                <Input
                  value={draft.requestId}
                  maxLength={80}
                  onChange={(e) => set("requestId", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Telefone</Field.Label>
                <Input
                  value={draft.phone}
                  maxLength={20}
                  placeholder="5511987654321"
                  onChange={(e) => set("phone", e.target.value)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Empresa Okton</Field.Label>
                <Input
                  value={draft.oktonCompanyId}
                  maxLength={60}
                  onChange={(e) => set("oktonCompanyId", e.target.value)}
                />
              </Field.Root>
            </Grid>

            <HStack mt="4" gap="2">
              <Button size="sm" onClick={() => setFilters(draft)} disabled={isFetching}>
                Aplicar filtros
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                }}
              >
                Limpar
              </Button>
            </HStack>
          </Card.Body>
        </Card.Root>

        <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
          <Card.Body pt="6">
            <Tabs.Root defaultValue="integracao">
              <Tabs.List>
                <Tabs.Trigger value="integracao">Integrações</Tabs.Trigger>
                <Tabs.Trigger value="auditoria">Auditoria</Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="integracao">
                <Stack gap="2">
                  {(logs ?? []).length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                      Nenhum registro para os filtros selecionados.
                    </Text>
                  ) : (
                    (logs ?? []).map((log) => (
                      <Box
                        as="details"
                        key={log.id}
                        rounded="l2"
                        borderWidth="1px"
                        borderColor="border"
                        px="3"
                        py="2"
                        fontSize="sm"
                      >
                        <HStack
                          as="summary"
                          cursor="pointer"
                          flexWrap="wrap"
                          alignItems="center"
                          justifyContent="space-between"
                          gap="2"
                        >
                          <Text truncate fontFamily="mono" fontSize="xs">
                            {log.method ?? "—"} {log.endpoint ?? log.service}
                          </Text>
                          <HStack flexWrap="wrap" gap="2">
                            <Badge variant="outline">{log.environment}</Badge>
                            <Badge
                              colorPalette={log.success ? undefined : "red"}
                              variant={log.success ? "subtle" : "solid"}
                            >
                              {log.status_code ?? (log.success ? "ok" : "erro")}
                            </Badge>
                            <Text fontSize="10px" color="fg.muted">
                              {log.duration_ms ?? 0} ms · {fmt(log.created_at)}
                            </Text>
                          </HStack>
                        </HStack>
                        <Stack mt="2" gap="1" fontSize="11px" color="fg.muted">
                          <Text>
                            Request ID:{" "}
                            <Text as="span" fontFamily="mono">
                              {log.request_id ?? "—"}
                            </Text>{" "}
                            · Telefone: {log.phone_masked ?? "—"} · Empresa Okton:{" "}
                            {log.okton_company_id ?? "—"} · Documento: {log.document_type ?? "—"}
                          </Text>
                          {log.error_message ? (
                            <Text color="fg.danger">{log.error_message}</Text>
                          ) : null}
                        </Stack>
                        <Box
                          as="pre"
                          mt="2"
                          maxH="72"
                          overflow="auto"
                          rounded="l2"
                          bg="bg.muted"
                          p="2"
                          fontSize="11px"
                        >
                          {JSON.stringify(
                            {
                              request: log.request_summary_json,
                              response: log.response_summary_json,
                            },
                            null,
                            2,
                          )}
                        </Box>
                      </Box>
                    ))
                  )}
                </Stack>
              </Tabs.Content>

              <Tabs.Content value="auditoria">
                <Stack gap="2">
                  {(audit ?? []).length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                      Nenhuma alteração registrada.
                    </Text>
                  ) : (
                    (audit ?? []).map((log) => (
                      <Box
                        as="details"
                        key={log.id}
                        rounded="l2"
                        borderWidth="1px"
                        borderColor="border"
                        px="3"
                        py="2"
                        fontSize="sm"
                      >
                        <HStack
                          as="summary"
                          cursor="pointer"
                          alignItems="center"
                          justifyContent="space-between"
                          gap="3"
                        >
                          <Text truncate fontFamily="mono" fontSize="xs">
                            {log.action}
                          </Text>
                          <HStack gap="2">
                            <Badge variant="subtle">{log.entity_type ?? "sistema"}</Badge>
                            <Text fontSize="10px" color="fg.muted">
                              {fmt(log.created_at)}
                            </Text>
                          </HStack>
                        </HStack>
                        <Box
                          as="pre"
                          mt="2"
                          maxH="64"
                          overflow="auto"
                          rounded="l2"
                          bg="bg.muted"
                          p="2"
                          fontSize="11px"
                        >
                          {JSON.stringify(
                            { antes: log.old_data_json, depois: log.new_data_json },
                            null,
                            2,
                          )}
                        </Box>
                      </Box>
                    ))
                  )}
                </Stack>
              </Tabs.Content>
            </Tabs.Root>
          </Card.Body>
        </Card.Root>
      </Stack>
    </AppShell>
  );
}
