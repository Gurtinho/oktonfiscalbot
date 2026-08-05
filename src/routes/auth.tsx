import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Box, Button, Card, Center, Field, Input, Tabs, Text } from "@chakra-ui/react";
import { toast } from "@/views/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/views/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Acessar o Okton Fiscal Bot" },
      {
        name: "description",
        content: "Entre no painel do Okton Fiscal Bot para configurar fluxos fiscais no WhatsApp.",
      },
      { property: "og:title", content: "Acessar o Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Painel de administração do middleware entre WhatsApp e o ERP Okton.",
      },
    ],
  }),
  component: AuthPage,
});

const signInSchema = z.object({
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(1, "Informe a senha"),
});

const signUpSchema = z.object({
  fullName: z.string().min(1, "Informe o nome"),
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(6, "A senha deve ter ao menos 6 caracteres"),
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [signInErrors, setSignInErrors] = useState<Record<string, string>>({});
  const [signUpErrors, setSignUpErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  const signIn = async () => {
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setSignInErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      toast.error("Verifique os campos destacados");
      return;
    }
    setSignInErrors({});
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/" });
  };

  const signUp = async () => {
    const parsed = signUpSchema.safeParse({ fullName, email, password });
    if (!parsed.success) {
      setSignUpErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      toast.error("Verifique os campos destacados");
      return;
    }
    setSignUpErrors({});
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: parsed.data.fullName },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada. Se a confirmação por e-mail estiver ativa, verifique sua caixa.");
  };

  return (
    <Center minH="100vh" bg="bg" px="4">
      <Card.Root w="full" maxW="md" borderColor="border" bg="bg.panel" shadow="panel">
        <Card.Header>
          <Card.Title fontSize="2xl" color="fg.brand">
            Okton Fiscal Bot
          </Card.Title>
          <Card.Description>
            Middleware entre o funil de WhatsApp e o ERP Okton. Acesse para configurar empresas,
            endpoints e fluxos de emissão.
          </Card.Description>
        </Card.Header>
        <Card.Body>
          <Tabs.Root defaultValue="entrar">
            <Tabs.List w="full">
              <Tabs.Trigger value="entrar" flex="1">
                Entrar
              </Tabs.Trigger>
              <Tabs.Trigger value="criar" flex="1">
                Criar conta
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="entrar">
              <Box display="flex" flexDirection="column" gap="4" pt="4">
                <Field.Root invalid={!!signInErrors.email}>
                  <Field.Label>E-mail</Field.Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <Field.ErrorText>{signInErrors.email}</Field.ErrorText>
                </Field.Root>
                <Field.Root invalid={!!signInErrors.password}>
                  <Field.Label>Senha</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Field.ErrorText>{signInErrors.password}</Field.ErrorText>
                </Field.Root>
                <Button w="full" disabled={busy} onClick={signIn}>
                  Entrar
                </Button>
              </Box>
            </Tabs.Content>

            <Tabs.Content value="criar">
              <Box display="flex" flexDirection="column" gap="4" pt="4">
                <Field.Root invalid={!!signUpErrors.fullName}>
                  <Field.Label>Nome</Field.Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  <Field.ErrorText>{signUpErrors.fullName}</Field.ErrorText>
                </Field.Root>
                <Field.Root invalid={!!signUpErrors.email}>
                  <Field.Label>E-mail</Field.Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <Field.ErrorText>{signUpErrors.email}</Field.ErrorText>
                </Field.Root>
                <Field.Root invalid={!!signUpErrors.password}>
                  <Field.Label>Senha</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Field.ErrorText>{signUpErrors.password}</Field.ErrorText>
                </Field.Root>
                <Button w="full" disabled={busy} onClick={signUp}>
                  Criar conta
                </Button>
                <Text fontSize="xs" color="fg.muted">
                  O primeiro usuário cadastrado recebe o papel de administrador.
                </Text>
              </Box>
            </Tabs.Content>
          </Tabs.Root>
        </Card.Body>
      </Card.Root>
    </Center>
  );
}
