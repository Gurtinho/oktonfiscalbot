import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileClock,
  FileWarning,
  MessagesSquare,
  Send,
  Webhook,
} from "lucide-react";
import { Badge, Button, Card, HStack, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";
import { StatCard } from "@/views/components/StatusDot";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Okton Fiscal Bot — Painel de emissão fiscal via WhatsApp" },
      {
        name: "description",
        content:
          "Middleware entre o funil de WhatsApp e o ERP Okton: conversas, rascunhos, emissões e webhooks em um só painel.",
      },
      { property: "og:title", content: "Okton Fiscal Bot — Painel" },
      {
        property: "og:description",
        content: "Acompanhe conversas, rascunhos, emissões e integrações do bot fiscal.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard-metrics"],
    refetchInterval: 20000,
    queryFn: async () => {
      const count = (result: { count: number | null }) => result.count ?? 0;
      const [conversations, drafts, emissions, authorized, rejected, errors, webhooks] =
        await Promise.all([
          supabase
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .neq("status", "finished"),
          supabase
            .from("drafts")
            .select("id", { count: "exact", head: true })
            .in("status", ["collecting", "validating", "awaiting_confirmation"]),
          supabase.from("emissions").select("id", { count: "exact", head: true }),
          supabase
            .from("emissions")
            .select("id", { count: "exact", head: true })
            .eq("status", "authorized"),
          supabase
            .from("emissions")
            .select("id", { count: "exact", head: true })
            .eq("status", "rejected"),
          supabase
            .from("integration_logs")
            .select("id", { count: "exact", head: true })
            .eq("success", false),
          supabase
            .from("webhook_events")
            .select("id,provider,event_type,processing_status,received_at")
            .order("received_at", { ascending: false })
            .limit(6),
        ]);

      return {
        conversations: count(conversations),
        drafts: count(drafts),
        emissions: count(emissions),
        authorized: count(authorized),
        rejected: count(rejected),
        errors: count(errors),
        webhooks: webhooks.data ?? [],
      };
    },
  });

  const cards = [
    {
      label: "Conversas em andamento",
      value: data?.conversations ?? 0,
      hint: "Funis abertos no WhatsApp",
      icon: MessagesSquare,
      tone: "default" as const,
    },
    {
      label: "Rascunhos",
      value: data?.drafts ?? 0,
      hint: "Aguardando validação",
      icon: FileClock,
      tone: "default" as const,
    },
    {
      label: "Emissões solicitadas",
      value: data?.emissions ?? 0,
      hint: "Enviadas à Okton",
      icon: Send,
      tone: "default" as const,
    },
    {
      label: "Documentos autorizados",
      value: data?.authorized ?? 0,
      hint: "Retorno positivo da Okton",
      icon: CheckCircle2,
      tone: "positive" as const,
    },
    {
      label: "Documentos rejeitados",
      value: data?.rejected ?? 0,
      hint: "Rejeições reportadas pela Okton",
      icon: FileWarning,
      tone: "negative" as const,
    },
    {
      label: "Erros de integração",
      value: data?.errors ?? 0,
      hint: "Falhas registradas em log",
      icon: AlertTriangle,
      tone: "negative" as const,
    },
  ];

  return (
    <AppShell
      title="Dashboard"
      description="Visão geral do middleware entre o funil de WhatsApp e o ERP Okton."
    >
      <SimpleGrid gap="4" columns={{ base: 1, sm: 2, xl: 3 }}>
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </SimpleGrid>

      <Card.Root borderColor="border" bg="bg.panel" shadow="panel" mt="6">
        <Card.Header
          display="grid"
          gridTemplateColumns="minmax(0, 1fr) auto"
          alignItems="center"
          gap="3"
        >
          <Stack minW="0" gap="1">
            <Card.Title display="flex" alignItems="center" gap="2" fontSize="base">
              <Icon as={Webhook} boxSize="4" color="fg.brand" /> Últimos webhooks recebidos
            </Card.Title>
            <Card.Description>Entradas do provedor de WhatsApp.</Card.Description>
          </Stack>
          <Button asChild variant="outline" size="sm">
            <Link to="/webhooks">Ver todos</Link>
          </Button>
        </Card.Header>
        <Card.Body>
          <Stack gap="2">
            {(data?.webhooks ?? []).length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                Nenhum webhook recebido ainda — configure um canal em Integração WhatsApp.
              </Text>
            ) : (
              data?.webhooks.map((event) => (
                <Stack
                  key={event.id}
                  direction="row"
                  display="grid"
                  gridTemplateColumns="minmax(0, 1fr) auto"
                  alignItems="center"
                  gap="3"
                  rounded="l2"
                  borderWidth="1px"
                  borderColor="border"
                  px="3"
                  py="2"
                  fontSize="sm"
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
                </Stack>
              ))
            )}
          </Stack>
        </Card.Body>
      </Card.Root>
    </AppShell>
  );
}
