import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Box, Card, HStack, Stack, Text } from "@chakra-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";

export const Route = createFileRoute("/webhooks")({
  head: () => ({
    meta: [
      { title: "Webhooks recebidos | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Inspecione os webhooks recebidos do provedor de WhatsApp e as respostas devolvidas pelo bot fiscal.",
      },
      { property: "og:title", content: "Webhooks recebidos | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Payloads de entrada do funil de WhatsApp em tempo quase real.",
      },
    ],
  }),
  component: WebhooksPage,
});

function WebhooksPage() {
  const { data: events } = useQuery({
    queryKey: ["webhook_events"],
    refetchInterval: 5000,
    queryFn: async () => {
      // teste "sorvete" — só exibe no grid eventos que são efetivamente
      // mensagens do cliente: provider whatsapp e status diferente de
      // "ignored" (ignored = eco do próprio bot / sem telefone / sem texto).
      const { data, error } = await supabase
        .from("webhook_events")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
      // teste "sorvete" — fim do bloco
    },
  });

  return (
    <AppShell
      title="Webhooks"
      description="Cada chamada recebida no endpoint público do WhatsApp fica registrada aqui."
    >
      <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
        <Card.Header>
          <Card.Title fontSize="base">Últimos webhooks recebidos</Card.Title>
          <Card.Description>Clique em um registro para ver o payload completo.</Card.Description>
        </Card.Header>
        <Card.Body>
          <Stack gap="2">
            {(events ?? []).length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                Nenhum webhook recebido ainda. Configure um canal em Integração WhatsApp.
              </Text>
            ) : (
              events?.map((event) => (
                <Box
                  as="details"
                  key={event.id}
                  rounded="l2"
                  borderWidth="1px"
                  borderColor="border"
                  px="3"
                  py="2"
                  fontSize="sm"
                >
                  <Box
                    as="summary"
                    cursor="pointer"
                    display="grid"
                    gridTemplateColumns="minmax(0, 1fr) auto"
                    alignItems="center"
                    gap="3"
                  >
                    <Text truncate fontFamily="mono" fontSize="xs">
                      {event.provider} · {event.event_type ?? "evento"}
                    </Text>
                    <HStack gap="2">
                      <Badge
                        colorPalette={event.processing_status === "failed" ? "red" : "gray"}
                        variant="subtle"
                      >
                        {event.processing_status}
                      </Badge>
                      <Text fontSize="10px" color="fg.muted">
                        {new Date(event.received_at).toLocaleString("pt-BR")}
                      </Text>
                    </HStack>
                  </Box>
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
                      {
                        payload: event.payload_json,
                        headers: event.headers_json,
                        erro: event.error_message,
                      },
                      null,
                      2,
                    )}
                    {/* {JSON.stringify(event.payload_json.message.body, null, 2)} */}
                  </Box>
                </Box>
              ))
            )}
          </Stack>
        </Card.Body>
      </Card.Root>
    </AppShell>
  );
}
