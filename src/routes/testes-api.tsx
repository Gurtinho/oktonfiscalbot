import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Download, Send } from "lucide-react";
import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  Flex,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { toast } from "@/views/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";
import {
  runOktonApiTest,
  runWhatsAppApiTest,
  exportInsomniaCollection,
} from "@/controllers/api-tester.functions";

export const Route = createFileRoute("/testes-api")({
  head: () => ({
    meta: [
      { title: "Testes de API | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Dispare requisições reais para a Okton e para o provedor de WhatsApp direto do painel, com resposta, status e tempo — e exporte a coleção para o Insomnia.",
      },
      { property: "og:title", content: "Testes de API | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Banco de testes de integrações Okton e WhatsApp com exportação para Insomnia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ApiTesterPage,
});

type TestResult = {
  ok: boolean;
  status: number;
  durationMs: number;
  url: string;
  method: string;
  requestPreview: string;
  responseText: string;
  error?: string;
  ranAt: string;
};

const jsonOrEmpty = z.string().refine((value) => {
  if (!value.trim()) return true;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}, "JSON inválido");

const oktonRequestSchema = z.object({
  method: z.string().min(1, "Informe o método"),
  path: z.string().min(1, "Informe o caminho"),
  pathParamsJson: jsonOrEmpty,
  queryJson: jsonOrEmpty,
  headersJson: jsonOrEmpty,
  bodyJson: jsonOrEmpty,
});

const whatsAppRequestSchema = z.object({
  channelId: z.string().min(1, "Selecione um canal de WhatsApp."),
  phone: z.string().min(1, "Informe o número de destino"),
  text: z.string().min(1, "Informe a mensagem"),
});

function ResultPanel({ result }: { result: TestResult | null }) {
  if (!result) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Nenhuma requisição executada ainda nesta aba.
      </Text>
    );
  }
  return (
    <Stack gap="3">
      <Flex align="center" wrap="wrap" gap="2">
        <Badge variant="subtle" colorPalette={result.ok ? "green" : "red"}>
          {result.ok ? "Sucesso" : "Falha"}
        </Badge>
        <Badge variant="outline">HTTP {result.status}</Badge>
        <Badge variant="outline">{result.durationMs} ms</Badge>
        <Text fontSize="xs" color="fg.muted">
          {new Date(result.ranAt).toLocaleString("pt-BR")}
        </Text>
      </Flex>
      {result.url ? (
        <Text wordBreak="break-all" fontSize="xs" color="fg.muted">
          {result.method} {result.url}
        </Text>
      ) : null}
      {result.error ? (
        <Text fontSize="sm" color="fg.danger">
          {result.error}
        </Text>
      ) : null}
      {result.requestPreview ? (
        <Box>
          <Text fontSize="xs">Enviado</Text>
          <Box
            as="pre"
            mt="1"
            maxH="48"
            overflow="auto"
            rounded="l2"
            bg="bg.muted"
            p="3"
            fontSize="xs"
          >
            {result.requestPreview}
          </Box>
        </Box>
      ) : null}
      <Box>
        <Text fontSize="xs">Resposta</Text>
        <Box
          as="pre"
          mt="1"
          maxH="80"
          overflow="auto"
          rounded="l2"
          bg="bg.muted"
          p="3"
          fontSize="xs"
        >
          {result.responseText || "(vazio)"}
        </Box>
      </Box>
    </Stack>
  );
}

function ApiTesterPage() {
  const callOkton = useServerFn(runOktonApiTest);
  const callWhatsApp = useServerFn(runWhatsAppApiTest);
  const exportCollection = useServerFn(exportInsomniaCollection);

  const { data: endpoints = [] } = useQuery({
    queryKey: ["api_endpoints", "tester"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_endpoints")
        .select("id, key, method, path, description")
        .order("key", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["whatsapp_channels", "tester"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_channels")
        .select("id, display_name, provider, instance_name, active")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ---- Okton
  const [endpointKey, setEndpointKey] = useState<string>("__manual__");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [pathParamsJson, setPathParamsJson] = useState("");
  const [queryJson, setQueryJson] = useState("");
  const [headersJson, setHeadersJson] = useState("");
  const [bodyJson, setBodyJson] = useState("");
  const [oktonResult, setOktonResult] = useState<TestResult | null>(null);
  const [oktonLoading, setOktonLoading] = useState(false);
  const [oktonErrors, setOktonErrors] = useState<Record<string, string>>({});

  // ---- WhatsApp
  const [channelId, setChannelId] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<"text" | "options" | "document" | "image">("text");
  const [text, setText] = useState("Mensagem de teste do Okton Fiscal Bot.");
  const [optionsText, setOptionsText] = useState("Sim\nNão");
  const [mediaUrl, setMediaUrl] = useState("");
  const [fileName, setFileName] = useState("documento.pdf");
  const [waResult, setWaResult] = useState<TestResult | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waErrors, setWaErrors] = useState<Record<string, string>>({});

  function selectEndpoint(value: string) {
    setEndpointKey(value);
    const endpoint = endpoints.find((item) => item.key === value);
    if (endpoint) {
      setMethod(endpoint.method.toUpperCase());
      setPath(endpoint.path);
    }
  }

  async function sendOkton() {
    const parsed = oktonRequestSchema.safeParse({
      method,
      path,
      pathParamsJson,
      queryJson,
      headersJson,
      bodyJson,
    });
    if (!parsed.success) {
      setOktonErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      toast.error("Verifique os campos destacados");
      return;
    }
    setOktonErrors({});
    setOktonLoading(true);
    try {
      const result = await callOkton({
        data: {
          endpointKey: endpointKey === "__manual__" ? null : endpointKey,
          method,
          path,
          pathParamsJson,
          queryJson,
          headersJson,
          bodyJson,
        },
      });
      setOktonResult(result as TestResult);
      if (!result.ok) toast.error(result.error ?? `Okton respondeu ${result.status}.`);
      else toast.success(`Okton respondeu ${result.status} em ${result.durationMs} ms.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao executar o teste.");
    } finally {
      setOktonLoading(false);
    }
  }

  async function sendWhatsApp() {
    const parsed = whatsAppRequestSchema.safeParse({ channelId, phone, text });
    if (!parsed.success) {
      setWaErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      toast.error(parsed.error.issues[0]?.message ?? "Verifique os campos destacados");
      return;
    }
    setWaErrors({});
    setWaLoading(true);
    try {
      const result = await callWhatsApp({
        data: { channelId, phone, kind, text, optionsText, mediaUrl, fileName },
      });
      setWaResult(result as TestResult);
      if (!result.ok) toast.error(result.error ?? `Provedor respondeu ${result.status}.`);
      else toast.success("Mensagem enviada ao provedor.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar a mensagem.");
    } finally {
      setWaLoading(false);
    }
  }

  async function downloadCollection() {
    try {
      const { json } = await exportCollection({
        data: { appOrigin: window.location.origin },
      });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "okton-fiscal-bot.insomnia.json";
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Coleção exportada. Importe no Insomnia em Application → Import.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar a coleção.");
    }
  }

  return (
    <AppShell
      title="Testes de API"
      description="Dispare chamadas reais para a Okton e para o WhatsApp pelo servidor, sem expor tokens."
      actions={
        <Button variant="outline" onClick={downloadCollection}>
          <Download size={16} />
          Exportar para Insomnia
        </Button>
      }
    >
      <Tabs.Root defaultValue="okton">
        <Tabs.List>
          <Tabs.Trigger value="okton">Okton</Tabs.Trigger>
          <Tabs.Trigger value="whatsapp">WhatsApp</Tabs.Trigger>
          <Tabs.Trigger value="insomnia">Insomnia</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="okton">
          <SimpleGrid gap="4" columns={{ base: 1, lg: 2 }}>
            <Card.Root>
              <Card.Header>
                <Card.Title>Requisição para a Okton</Card.Title>
                <Card.Description>
                  Usa a conexão ativa e os segredos do servidor. O token nunca chega ao navegador.
                </Card.Description>
              </Card.Header>
              <Card.Body>
                <Stack gap="3">
                  <Field.Root>
                    <Field.Label>Operação cadastrada</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={endpointKey}
                        onChange={(event) => selectEndpoint(event.currentTarget.value)}
                      >
                        <option value="__manual__">Requisição manual</option>
                        {endpoints.map((endpoint) => (
                          <option key={endpoint.id} value={endpoint.key}>
                            {endpoint.key} · {endpoint.method} {endpoint.path}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>
                  <SimpleGrid
                    gap="3"
                    columns={{ base: 1, sm: 2 }}
                    templateColumns={{ sm: "120px 1fr" }}
                  >
                    <Field.Root>
                      <Field.Label>Método</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={method}
                          onChange={(event) => setMethod(event.currentTarget.value)}
                        >
                          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>
                    <Field.Root invalid={!!oktonErrors.path}>
                      <Field.Label>Caminho</Field.Label>
                      <Input value={path} onChange={(event) => setPath(event.target.value)} />
                      {oktonErrors.path ? (
                        <Field.ErrorText>{oktonErrors.path}</Field.ErrorText>
                      ) : null}
                    </Field.Root>
                  </SimpleGrid>
                  <SimpleGrid gap="3" columns={{ base: 1, sm: 2 }}>
                    <Field.Root invalid={!!oktonErrors.pathParamsJson}>
                      <Field.Label>Parâmetros do caminho (JSON)</Field.Label>
                      <Textarea
                        rows={3}
                        placeholder={'{ "cnpj": "00000000000191" }'}
                        value={pathParamsJson}
                        onChange={(event) => setPathParamsJson(event.target.value)}
                      />
                      {oktonErrors.pathParamsJson ? (
                        <Field.ErrorText>{oktonErrors.pathParamsJson}</Field.ErrorText>
                      ) : null}
                    </Field.Root>
                    <Field.Root invalid={!!oktonErrors.queryJson}>
                      <Field.Label>Query string (JSON)</Field.Label>
                      <Textarea
                        rows={3}
                        placeholder={'{ "page": "1" }'}
                        value={queryJson}
                        onChange={(event) => setQueryJson(event.target.value)}
                      />
                      {oktonErrors.queryJson ? (
                        <Field.ErrorText>{oktonErrors.queryJson}</Field.ErrorText>
                      ) : null}
                    </Field.Root>
                  </SimpleGrid>
                  <Field.Root invalid={!!oktonErrors.headersJson}>
                    <Field.Label>Headers extras (JSON)</Field.Label>
                    <Textarea
                      rows={2}
                      placeholder={'{ "X-Custom": "valor" }'}
                      value={headersJson}
                      onChange={(event) => setHeadersJson(event.target.value)}
                    />
                    {oktonErrors.headersJson ? (
                      <Field.ErrorText>{oktonErrors.headersJson}</Field.ErrorText>
                    ) : null}
                  </Field.Root>
                  <Field.Root invalid={!!oktonErrors.bodyJson}>
                    <Field.Label>Corpo (JSON)</Field.Label>
                    <Textarea
                      rows={8}
                      fontFamily="mono"
                      fontSize="xs"
                      placeholder={'{\n  "cnpj": "00000000000191"\n}'}
                      value={bodyJson}
                      onChange={(event) => setBodyJson(event.target.value)}
                    />
                    {oktonErrors.bodyJson ? (
                      <Field.ErrorText>{oktonErrors.bodyJson}</Field.ErrorText>
                    ) : null}
                  </Field.Root>
                  <Button onClick={sendOkton} disabled={oktonLoading}>
                    <Send size={16} />
                    {oktonLoading ? "Enviando..." : "Enviar requisição"}
                  </Button>
                </Stack>
              </Card.Body>
            </Card.Root>

            <Card.Root>
              <Card.Header>
                <Card.Title>Resultado</Card.Title>
                <Card.Description>Status, tempo e corpo da resposta da Okton.</Card.Description>
              </Card.Header>
              <Card.Body>
                <ResultPanel result={oktonResult} />
              </Card.Body>
            </Card.Root>
          </SimpleGrid>
        </Tabs.Content>

        <Tabs.Content value="whatsapp">
          <SimpleGrid gap="4" columns={{ base: 1, lg: 2 }}>
            <Card.Root>
              <Card.Header>
                <Card.Title>Envio pelo provedor de WhatsApp</Card.Title>
                <Card.Description>
                  Envia de verdade pelo canal escolhido, usando o mesmo código do bot.
                </Card.Description>
              </Card.Header>
              <Card.Body>
                <Stack gap="3">
                  <Field.Root invalid={!!waErrors.channelId}>
                    <Field.Label>Canal</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={channelId}
                        onChange={(event) => setChannelId(event.currentTarget.value)}
                      >
                        <option value="" disabled>
                          Selecione o canal
                        </option>
                        {channels.map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.display_name ?? channel.provider} · {channel.instance_name}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                    {waErrors.channelId ? (
                      <Field.ErrorText>{waErrors.channelId}</Field.ErrorText>
                    ) : channels.length === 0 ? (
                      <Text fontSize="xs" color="fg.muted">
                        Nenhum canal cadastrado em Integração WhatsApp.
                      </Text>
                    ) : null}
                  </Field.Root>
                  <SimpleGrid gap="3" columns={{ base: 1, sm: 2 }}>
                    <Field.Root invalid={!!waErrors.phone}>
                      <Field.Label>Número de destino</Field.Label>
                      <Input
                        placeholder="5511999999999"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                      />
                      {waErrors.phone ? <Field.ErrorText>{waErrors.phone}</Field.ErrorText> : null}
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Tipo de mensagem</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={kind}
                          onChange={(event) => setKind(event.currentTarget.value as typeof kind)}
                        >
                          <option value="text">Texto</option>
                          <option value="options">Texto com opções</option>
                          <option value="document">Documento (PDF/XML)</option>
                          <option value="image">Imagem</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>
                  </SimpleGrid>
                  <Field.Root invalid={!!waErrors.text}>
                    <Field.Label>Mensagem</Field.Label>
                    <Textarea
                      rows={4}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                    {waErrors.text ? <Field.ErrorText>{waErrors.text}</Field.ErrorText> : null}
                  </Field.Root>
                  {kind === "options" ? (
                    <Field.Root>
                      <Field.Label>Opções (uma por linha)</Field.Label>
                      <Textarea
                        rows={4}
                        value={optionsText}
                        onChange={(event) => setOptionsText(event.target.value)}
                      />
                    </Field.Root>
                  ) : null}
                  {kind === "document" || kind === "image" ? (
                    <SimpleGrid gap="3" columns={{ base: 1, sm: 2 }}>
                      <Field.Root>
                        <Field.Label>URL do arquivo</Field.Label>
                        <Input
                          placeholder="https://exemplo/danfe.pdf"
                          value={mediaUrl}
                          onChange={(event) => setMediaUrl(event.target.value)}
                        />
                      </Field.Root>
                      {kind === "document" ? (
                        <Field.Root>
                          <Field.Label>Nome do arquivo</Field.Label>
                          <Input
                            value={fileName}
                            onChange={(event) => setFileName(event.target.value)}
                          />
                        </Field.Root>
                      ) : null}
                    </SimpleGrid>
                  ) : null}
                  <Button onClick={sendWhatsApp} disabled={waLoading}>
                    <Send size={16} />
                    {waLoading ? "Enviando..." : "Enviar mensagem"}
                  </Button>
                </Stack>
              </Card.Body>
            </Card.Root>

            <Card.Root>
              <Card.Header>
                <Card.Title>Resultado</Card.Title>
                <Card.Description>
                  Toda tentativa fica registrada em Logs de integração.
                </Card.Description>
              </Card.Header>
              <Card.Body>
                <ResultPanel result={waResult} />
              </Card.Body>
            </Card.Root>
          </SimpleGrid>
        </Tabs.Content>

        <Tabs.Content value="insomnia">
          <Card.Root>
            <Card.Header>
              <Card.Title>Testar por fora, no Insomnia</Card.Title>
              <Card.Description>
                Exporte uma coleção pronta com as operações da Okton, os envios do WhatsApp e os
                webhooks deste bot.
              </Card.Description>
            </Card.Header>
            <Card.Body>
              <Stack gap="4" fontSize="sm">
                <Box as="ol" listStyleType="decimal" pl="5" color="fg.muted">
                  <Box as="li" mb="2">
                    Clique em “Exportar para Insomnia” e salve o arquivo JSON.
                  </Box>
                  <Box as="li" mb="2">
                    No Insomnia, use Application → Import → From File.
                  </Box>
                  <Box as="li" mb="2">
                    Abra o ambiente “Base” e preencha <Box as="code">okton_token</Box> e{" "}
                    <Box as="code">whatsapp_token</Box> com as credenciais reais — elas não são
                    exportadas por segurança.
                  </Box>
                  <Box as="li">
                    Dispare as requisições normalmente; os webhooks já apontam para este app.
                  </Box>
                </Box>
                <Button onClick={downloadCollection}>
                  <Download size={16} />
                  Baixar coleção
                </Button>
              </Stack>
            </Card.Body>
          </Card.Root>
        </Tabs.Content>
      </Tabs.Root>
    </AppShell>
  );
}
