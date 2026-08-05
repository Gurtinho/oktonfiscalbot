import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  Badge,
  Box,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Switch,
  Table,
  Text,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/views/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/views/components/AppShell";
import { useAuth } from "@/views/hooks/useAuth";

export const Route = createFileRoute("/empresas")({
  head: () => ({
    meta: [
      { title: "Empresas | Okton Fiscal Bot" },
      {
        name: "description",
        content: "Cadastre as empresas habilitadas e vincule cada CNPJ ao identificador da Okton.",
      },
      { property: "og:title", content: "Empresas | Okton Fiscal Bot" },
      {
        property: "og:description",
        content:
          "Multiempresa: CNPJ, razão social e identificador Okton para roteamento das conversas.",
      },
    ],
  }),
  component: CompaniesPage,
});

const companySchema = z.object({
  cnpj: z
    .string()
    .refine((v) => v.replace(/\D/g, "").length === 14, "Informe um CNPJ com 14 dígitos"),
  razao_social: z.string().min(1, "Informe a razão social"),
  nome_fantasia: z.string().optional(),
  okton_company_id: z.string().optional(),
});

function CompaniesPage() {
  const queryClient = useQueryClient();
  const { canConfigure, isAdmin, organizationId } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    cnpj: "",
    razao_social: "",
    nome_fantasia: "",
    okton_company_id: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").order("razao_social");
      if (error) throw error;
      return data;
    },
  });

  const save = async () => {
    const parsed = companySchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Verifique os campos destacados");
      return;
    }
    setErrors({});
    const cnpj = parsed.data.cnpj.replace(/\D/g, "");

    const { error } = await supabase.from("companies").insert({
      organization_id: organizationId,
      cnpj,
      razao_social: parsed.data.razao_social.trim(),
      nome_fantasia: parsed.data.nome_fantasia?.trim() || null,
      okton_company_id: parsed.data.okton_company_id?.trim() || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Empresa cadastrada.");
    setForm({ cnpj: "", razao_social: "", nome_fantasia: "", okton_company_id: "" });
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["companies"] });
  };

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await supabase.from("companies").update({ active }).eq("id", id);
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["companies"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Empresa removida.");
    queryClient.invalidateQueries({ queryKey: ["companies"] });
  };

  const fields = [
    { key: "cnpj", label: "CNPJ (somente números)" },
    { key: "razao_social", label: "Razão social" },
    { key: "nome_fantasia", label: "Nome fantasia" },
    { key: "okton_company_id", label: "ID da empresa na Okton" },
  ] as const;

  return (
    <AppShell
      title="Empresas"
      description="A Okton continua sendo a fonte oficial dos dados; aqui apenas habilitamos os CNPJs atendidos pelo bot."
      actions={
        canConfigure ? (
          <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
            <Dialog.Trigger asChild>
              <Button>
                <Plus /> Nova empresa
              </Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>Cadastrar empresa</Dialog.Title>
                    <Text fontSize="sm" color="fg.muted">
                      O CNPJ é usado para identificar a empresa nas mensagens do WhatsApp.
                    </Text>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Stack gap="4">
                      {fields.map((field) => (
                        <Field.Root key={field.key} invalid={!!errors[field.key]}>
                          <Field.Label>{field.label}</Field.Label>
                          <Input
                            value={form[field.key]}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                          />
                          <Field.ErrorText>{errors[field.key]}</Field.ErrorText>
                        </Field.Root>
                      ))}
                      <Button w="full" onClick={save}>
                        Salvar
                      </Button>
                    </Stack>
                  </Dialog.Body>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        ) : null
      }
    >
      <Card.Root borderColor="border" bg="bg.panel" shadow="panel">
        <Card.Header>
          <Card.Title fontSize="base">Empresas habilitadas</Card.Title>
        </Card.Header>
        <Card.Body>
          <Table.ScrollArea>
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>CNPJ</Table.ColumnHeader>
                  <Table.ColumnHeader>Razão social</Table.ColumnHeader>
                  <Table.ColumnHeader>ID Okton</Table.ColumnHeader>
                  <Table.ColumnHeader>Ativa</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(companies ?? []).length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={5}>
                      <Text fontSize="sm" color="fg.muted">
                        Nenhuma empresa cadastrada.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ) : (
                  companies?.map((company) => (
                    <Table.Row key={company.id}>
                      <Table.Cell fontFamily="mono" fontSize="xs">
                        {company.cnpj}
                      </Table.Cell>
                      <Table.Cell>
                        {company.razao_social}
                        {company.nome_fantasia ? (
                          <Box as="span" display="block" fontSize="xs" color="fg.muted">
                            {company.nome_fantasia}
                          </Box>
                        ) : null}
                      </Table.Cell>
                      <Table.Cell>
                        {company.okton_company_id ? (
                          <Badge variant="subtle">{company.okton_company_id}</Badge>
                        ) : (
                          <Text as="span" fontSize="xs" color="fg.muted">
                            não informado
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Switch.Root
                          checked={company.active}
                          disabled={!canConfigure}
                          onCheckedChange={(e) => toggleActive(company.id, e.checked)}
                        >
                          <Switch.HiddenInput />
                          <Switch.Control />
                        </Switch.Root>
                      </Table.Cell>
                      <Table.Cell textAlign="right">
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Remover"
                            onClick={() => remove(company.id)}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
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
