import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, Table } from "@chakra-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";

export const Route = createFileRoute("/rascunhos")({
  head: () => ({
    meta: [
      { title: "Rascunhos fiscais | Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Acompanhe os rascunhos montados nas conversas de WhatsApp antes da validação e confirmação na Okton.",
      },
      { property: "og:title", content: "Rascunhos fiscais | Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Dados coletados no funil aguardando validação da Okton.",
      },
    ],
  }),
  component: DraftsPage,
});

function DraftsPage() {
  const { data: drafts } = useQuery({
    queryKey: ["drafts-page"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drafts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell
      title="Rascunhos"
      description="Nenhum cálculo é feito aqui: o rascunho apenas organiza os dados que serão enviados à Okton."
    >
      <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
        <Card.Header>
          <Card.Title fontSize="base">Rascunhos em aberto</Card.Title>
          <Card.Description>Atualiza automaticamente a cada 15 segundos.</Card.Description>
        </Card.Header>
        <Card.Body>
          <Table.ScrollArea>
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Documento</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Criado em</Table.ColumnHeader>
                  <Table.ColumnHeader>Atualizado em</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(drafts ?? []).length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={4} fontSize="sm" color="fg.muted">
                      Nenhum rascunho no momento.
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  drafts?.map((draft) => (
                    <Table.Row key={draft.id}>
                      <Table.Cell textTransform="uppercase">{draft.document_type}</Table.Cell>
                      <Table.Cell>
                        <Badge variant="subtle">{draft.status}</Badge>
                      </Table.Cell>
                      <Table.Cell fontSize="xs" color="fg.muted">
                        {new Date(draft.created_at).toLocaleString("pt-BR")}
                      </Table.Cell>
                      <Table.Cell fontSize="xs" color="fg.muted">
                        {new Date(draft.updated_at).toLocaleString("pt-BR")}
                      </Table.Cell>
                    </Table.Row>
                  ))
                )}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </Card.Body>
      </Card.Root>
    </AppShell>
  );
}
