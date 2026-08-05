import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Card, HStack, Stack, Table, Text } from "@chakra-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";

export const Route = createFileRoute("/emissoes")({
  head: () => ({
    meta: [
      { title: "Emissões fiscais | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Histórico de emissões de NF-e, CT-e e MDF-e solicitadas pelo WhatsApp e processadas pelo ERP Okton.",
      },
      { property: "og:title", content: "Emissões fiscais | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Status, chave de acesso e idempotência de cada documento emitido pela Okton.",
      },
    ],
  }),
  component: EmissionsPage,
});

type RejectionDetail = {
  code?: string;
  friendly_message?: string;
  technical_message?: string;
  field?: string | null;
  field_label?: string | null;
  correctable?: boolean;
  message?: string | null;
  /** ETAPA 22 — leitura da IA sobre a rejeição devolvida pela Okton. */
  ai_explanation?: {
    explanation?: string;
    next_step?: string;
    model?: string;
    generated_at?: string;
  } | null;
};

function EmissionsPage() {
  const { data: emissions } = useQuery({
    queryKey: ["emissions"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emissions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: drafts } = useQuery({
    queryKey: ["drafts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drafts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell
      title="Emissões"
      description="A Okton é a única responsável por calcular, gerar o XML e transmitir à SEFAZ."
    >
      <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
        <Card.Header>
          <Card.Title fontSize="base">Documentos emitidos</Card.Title>
          <Card.Description>
            Cada emissão possui uma chave de idempotência que impede duplicidade.
          </Card.Description>
        </Card.Header>
        <Card.Body>
          <Table.ScrollArea>
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Documento</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Protocolo</Table.ColumnHeader>
                  <Table.ColumnHeader>Chave de acesso</Table.ColumnHeader>
                  <Table.ColumnHeader>Rejeição</Table.ColumnHeader>
                  <Table.ColumnHeader>Data</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(emissions ?? []).length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={6} fontSize="sm" color="fg.muted">
                      Nenhuma emissão registrada.
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  emissions?.map((emission) => (
                    <Table.Row key={emission.id}>
                      <Table.Cell textTransform="uppercase">{emission.document_type}</Table.Cell>
                      <Table.Cell>
                        <Badge
                          colorPalette={
                            emission.status === "rejected" || emission.status === "error"
                              ? "red"
                              : "gray"
                          }
                          variant="subtle"
                        >
                          {emission.status}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{emission.protocol ?? "—"}</Table.Cell>
                      <Table.Cell maxW="220px" truncate fontFamily="mono" fontSize="xs">
                        {emission.access_key ?? "—"}
                      </Table.Cell>
                      <Table.Cell maxW="280px" fontSize="xs">
                        {emission.rejection ? (
                          <RejectionCell rejection={emission.rejection as RejectionDetail} />
                        ) : (
                          <Text color="fg.muted">—</Text>
                        )}
                      </Table.Cell>
                      <Table.Cell fontSize="xs" color="fg.muted">
                        {new Date(emission.created_at).toLocaleString("pt-BR")}
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </Card.Body>
      </Card.Root>

      <Card.Root borderColor="border" bg="bg.panel" shadow="panel" mt="6">
        <Card.Header>
          <Card.Title fontSize="base">Rascunhos</Card.Title>
          <Card.Description>Dados coletados aguardando validação ou confirmação.</Card.Description>
        </Card.Header>
        <Card.Body>
          <Stack gap="2">
            {(drafts ?? []).length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                Nenhum rascunho no momento.
              </Text>
            ) : (
              drafts?.map((draft) => (
                <HStack
                  key={draft.id}
                  justify="space-between"
                  rounded="l2"
                  borderWidth="1px"
                  borderColor="border"
                  px="3"
                  py="2"
                  fontSize="sm"
                >
                  <Text textTransform="uppercase">{draft.document_type}</Text>
                  <HStack gap="3">
                    <Badge variant="subtle">{draft.status}</Badge>
                    <Text fontSize="xs" color="fg.muted">
                      {new Date(draft.created_at).toLocaleString("pt-BR")}
                    </Text>
                  </HStack>
                </HStack>
              ))
            )}
          </Stack>
        </Card.Body>
      </Card.Root>
    </AppShell>
  );
}

/** ETAPA 17 — mensagem simplificada + mensagem técnica (somente no painel). */
function RejectionCell({ rejection }: { rejection: RejectionDetail }) {
  const friendly = rejection.friendly_message ?? rejection.message ?? "Rejeição sem detalhe.";
  const technical = rejection.technical_message;
  return (
    <Stack gap="1">
      <Text fontWeight="medium" color="fg.danger">
        {rejection.code ? `${rejection.code} — ` : ""}
        {friendly}
      </Text>
      {rejection.ai_explanation?.explanation ? (
        <Box
          rounded="l2"
          borderWidth="1px"
          borderColor="border.brand"
          bg="brand.subtle"
          p="2"
          color="brand.fg"
        >
          <Text
            fontSize="11px"
            fontWeight="semibold"
            textTransform="uppercase"
            letterSpacing="wide"
          >
            Leitura da IA
          </Text>
          <Text mt="1">{rejection.ai_explanation.explanation}</Text>
          {rejection.ai_explanation.next_step ? (
            <Text mt="1" fontWeight="medium">
              {rejection.ai_explanation.next_step}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {rejection.field_label || rejection.field ? (
        <Text color="fg.muted">Campo: {rejection.field_label ?? rejection.field}</Text>
      ) : null}

      {technical && technical !== friendly ? (
        <Box as="details" color="fg.muted">
          <Box as="summary" cursor="pointer">
            Mensagem técnica
          </Box>
          <Text mt="1" fontFamily="mono" wordBreak="break-word">
            {technical}
          </Text>
        </Box>
      ) : null}
    </Stack>
  );
}
