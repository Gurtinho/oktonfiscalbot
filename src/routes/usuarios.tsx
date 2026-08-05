import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, HStack, SimpleGrid, Table } from "@chakra-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";
import { ROLE_LABEL, useAuth } from "@/views/hooks/useAuth";

export const Route = createFileRoute("/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários e permissões | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Gerencie quem acessa o painel do Okton Fiscal Bot e quais papéis cada pessoa possui.",
      },
      { property: "og:title", content: "Usuários e permissões | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Papéis admin, operador e visualizador do painel fiscal.",
      },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { isAdmin } = useAuth();

  const { data: people } = useQuery({
    queryKey: ["profiles-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_users")
        .select("id,name,email,role,status,created_at")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell
      title="Usuários e permissões"
      description="Os papéis controlam o que cada pessoa pode ver e alterar no painel."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/configuracoes">Configurações</Link>
        </Button>
      }
    >
      <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
        <Card.Header>
          <Card.Title fontSize="base">Pessoas com acesso</Card.Title>
          <Card.Description>
            {isAdmin
              ? "Como administrador, você pode ajustar papéis nas próximas etapas."
              : "Somente administradores alteram papéis."}
          </Card.Description>
        </Card.Header>
        <Card.Body>
          <Table.ScrollArea>
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Nome</Table.ColumnHeader>
                  <Table.ColumnHeader>E-mail</Table.ColumnHeader>
                  <Table.ColumnHeader>Papel</Table.ColumnHeader>
                  <Table.ColumnHeader>Desde</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(people ?? []).length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={4} fontSize="sm" color="fg.muted">
                      Nenhum usuário visível com suas permissões atuais.
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  people?.map((person) => (
                    <Table.Row key={person.id}>
                      <Table.Cell>{person.name}</Table.Cell>
                      <Table.Cell fontSize="xs">{person.email ?? "—"}</Table.Cell>
                      <Table.Cell>
                        <HStack gap="1">
                          <Badge variant="subtle" textTransform="uppercase">
                            {ROLE_LABEL[person.role]}
                          </Badge>
                          {person.status !== "active" ? (
                            <Badge variant="outline">{person.status}</Badge>
                          ) : null}
                        </HStack>
                      </Table.Cell>
                      <Table.Cell fontSize="xs" color="fg.muted">
                        {new Date(person.created_at).toLocaleDateString("pt-BR")}
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </Card.Body>
      </Card.Root>

      <SimpleGrid gap="4" columns={{ base: 1, md: 3 }} mt="4">
        {[
          { role: "Administrador", text: "Acesso total: integrações, fluxos, empresas e papéis." },
          { role: "Gestor", text: "Configura fluxos e integrações e visualiza emissões." },
          { role: "Operador", text: "Acompanha conversas, rascunhos e emissões." },
          { role: "Auditor", text: "Consulta apenas logs e históricos." },
          { role: "Suporte", text: "Acompanha conversas, erros e webhooks." },
        ].map((item) => (
          <Card.Root key={item.role} borderColor="border" bg="bg.panel" shadow="panel">
            <Card.Header>
              <Card.Title fontSize="base">{item.role}</Card.Title>
            </Card.Header>
            <Card.Body fontSize="sm" color="fg.muted">
              {item.text}
            </Card.Body>
          </Card.Root>
        ))}
      </SimpleGrid>
    </AppShell>
  );
}
