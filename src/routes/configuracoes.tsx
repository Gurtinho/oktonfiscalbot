import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Plug, ShieldCheck, Workflow } from "lucide-react";
import { Button, Card, HStack, Icon, SimpleGrid, Text } from "@chakra-ui/react";
import { AppShell } from "@/views/components/AppShell";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Centralize empresas, integrações e regras operacionais do middleware entre WhatsApp e o ERP Okton.",
      },
      { property: "og:title", content: "Configurações | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Empresas, integrações e políticas do Okton Fiscal Bot.",
      },
    ],
  }),
  component: SettingsPage,
});

const LINKS = [
  {
    to: "/empresas",
    title: "Empresas",
    description: "CNPJs habilitados e vínculo com o identificador da Okton.",
    icon: Building2,
  },
  {
    to: "/integracao-okton",
    title: "Integração Okton",
    description: "Conexões, ambiente e endpoints por operação.",
    icon: Plug,
  },
  {
    to: "/fluxos",
    title: "Fluxos de conversa",
    description: "Perguntas e ordem de coleta por tipo de documento.",
    icon: Workflow,
  },
] as const;

function SettingsPage() {
  return (
    <AppShell
      title="Configurações"
      description="Ajustes gerais do middleware. As regras fiscais permanecem sempre na Okton."
    >
      <SimpleGrid gap="4" columns={{ base: 1, md: 3 }}>
        {LINKS.map((link) => {
          const LinkIcon = link.icon;
          return (
            <Card.Root key={link.to} borderColor="border" bg="bg.panel" shadow="panel">
              <Card.Header>
                <Icon as={LinkIcon} boxSize="5" color="fg.brand" />
                <Card.Title fontSize="base">{link.title}</Card.Title>
                <Card.Description>{link.description}</Card.Description>
              </Card.Header>
              <Card.Body>
                <Button asChild variant="outline" size="sm">
                  <Link to={link.to}>Abrir</Link>
                </Button>
              </Card.Body>
            </Card.Root>
          );
        })}
      </SimpleGrid>

      <Card.Root borderColor="border.brand" bg="bg.panel" shadow="panel" mt="6">
        <Card.Header>
          <HStack gap="2">
            <Icon as={ShieldCheck} boxSize="4" color="fg.brand" />
            <Card.Title fontSize="base">Políticas fixas do produto</Card.Title>
          </HStack>
        </Card.Header>
        <Card.Body>
          <SimpleGrid gap="2" columns={{ base: 1, sm: 2 }} fontSize="sm" color="fg.muted">
            <Text>Nenhum cálculo tributário local.</Text>
            <Text>Nenhum XML fiscal gerado localmente.</Text>
            <Text>Nenhuma comunicação direta com a SEFAZ.</Text>
            <Text>Tokens da Okton nunca chegam ao navegador.</Text>
            <Text>Endpoints sempre configuráveis por conexão.</Text>
            <Text>Emissões protegidas por chave de idempotência.</Text>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>
    </AppShell>
  );
}
