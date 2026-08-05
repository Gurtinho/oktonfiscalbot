import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Box,
  Button,
  Center,
  Drawer,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  Activity,
  Building2,
  FileCheck2,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Plug,
  Settings,
  Users,
  Webhook,
  Workflow,
} from "lucide-react";
import { useAuth } from "@/views/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { StatusDot } from "@/views/components/StatusDot";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/integracao-okton", label: "Integração Okton", icon: Plug },
  { to: "/integracao-whatsapp", label: "Integração WhatsApp", icon: MessagesSquare },
  { to: "/fluxos", label: "Fluxos de conversa", icon: Workflow },
  { to: "/conversas", label: "Conversas", icon: MessagesSquare },
  { to: "/simulador", label: "Simulador", icon: MessagesSquare },
  { to: "/testes-api", label: "Testes de API", icon: Plug },
  { to: "/rascunhos", label: "Rascunhos", icon: FileClock },
  { to: "/emissoes", label: "Emissões", icon: FileCheck2 },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/logs", label: "Logs", icon: Activity },
  { to: "/usuarios", label: "Usuários e permissões", icon: Users },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <Stack as="nav" gap="1" flex="1" overflowY="auto">
      {NAV.map((item) => {
        const active = pathname === item.to;
        return (
          <Link key={item.to} to={item.to} onClick={onNavigate}>
            <HStack
              gap="3"
              rounded="l2"
              px="3"
              py="2"
              fontSize="sm"
              transition="background 0.15s, color 0.15s"
              bg={active ? "bg.muted" : "transparent"}
              fontWeight={active ? "medium" : "normal"}
              color={active ? "fg" : "fg.muted"}
              _hover={{ bg: "bg.muted", color: "fg" }}
            >
              <Icon as={item.icon} boxSize="4" flexShrink={0} />
              <Text truncate>{item.label}</Text>
            </HStack>
          </Link>
        );
      })}
    </Stack>
  );
}

export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, loading, roleLabel, appUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companyId, setCompanyId] = useState<string>("all");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    const stored = window.localStorage.getItem("okton.company");
    if (stored) setCompanyId(stored);
  }, []);

  const { data: companies } = useQuery({
    queryKey: ["shell-companies"],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("companies")
        .select("id,razao_social")
        .order("razao_social");
      return data ?? [];
    },
  });

  const { data: status } = useQuery({
    queryKey: ["shell-status"],
    enabled: !!user,
    refetchInterval: 30000,
    queryFn: async () => {
      const [okton, whats] = await Promise.all([
        supabase.from("api_connections").select("environment").eq("active", true).limit(1),
        supabase.from("whatsapp_channels").select("id").eq("active", true).limit(1),
      ]);
      return {
        oktonOnline: (okton.data ?? []).length > 0,
        environment: okton.data?.[0]?.environment ?? "não configurado",
        whatsappOnline: (whats.data ?? []).length > 0,
      };
    },
  });

  if (loading || !user) {
    return (
      <Center minH="100vh" bg="bg">
        <Text fontSize="sm" color="fg.muted">
          Carregando…
        </Text>
      </Center>
    );
  }

  const sidebarInner = (
    <>
      <Box mb="6" px="2">
        <Heading as="p" fontFamily="heading" fontSize="lg" fontWeight="bold" color="fg.brand">
          Okton Fiscal Bot
        </Heading>
        <Text fontSize="xs" color="fg.muted">
          Middleware WhatsApp × Okton
        </Text>
      </Box>
      <NavList onNavigate={() => setMobileOpen(false)} />
      <Stack gap="2" mt="4" pt="4" borderTopWidth="1px" borderColor="border">
        <Text px="2" fontSize="xs" color="fg.muted" truncate>
          {user.email}
        </Text>
        {roleLabel ? (
          <Box px="2">
            <Badge size="sm" colorPalette="gray" textTransform="uppercase">
              {roleLabel}
            </Badge>
          </Box>
        ) : null}
        <Button variant="ghost" size="sm" justifyContent="flex-start" onClick={() => signOut()}>
          <LogOut /> Sair
        </Button>
      </Stack>
    </>
  );

  return (
    <Flex minH="100vh" bg="bg">
      <Stack
        as="aside"
        display={{ base: "none", lg: "flex" }}
        w="64"
        flexShrink={0}
        borderRightWidth="1px"
        borderColor="border"
        bg="bg.sidebar"
        p="4"
        gap="0"
      >
        {sidebarInner}
      </Stack>

      <Flex direction="column" flex="1" minW="0">
        <Box
          as="header"
          position="sticky"
          top="0"
          zIndex="20"
          borderBottomWidth="1px"
          borderColor="border"
          bg="bg"
          backdropFilter="blur(8px)"
        >
          <Flex align="center" gap="3" px={{ base: "4", lg: "6" }} py="3">
            <HStack gap="2">
              <Drawer.Root
                open={mobileOpen}
                onOpenChange={(e) => setMobileOpen(e.open)}
                placement="start"
              >
                <Drawer.Trigger asChild>
                  <IconButton
                    aria-label="Abrir navegação"
                    variant="ghost"
                    size="sm"
                    display={{ base: "inline-flex", lg: "none" }}
                  >
                    <Menu />
                  </IconButton>
                </Drawer.Trigger>
                <Portal>
                  <Drawer.Backdrop />
                  <Drawer.Positioner>
                    <Drawer.Content bg="bg.sidebar" maxW="18rem">
                      <Drawer.Title srOnly>Navegação</Drawer.Title>
                      <Stack p="4" gap="0" h="100%">
                        {sidebarInner}
                      </Stack>
                    </Drawer.Content>
                  </Drawer.Positioner>
                </Portal>
              </Drawer.Root>
              <Text
                display={{ base: "none", sm: "inline" }}
                fontFamily="heading"
                fontSize="sm"
                fontWeight="semibold"
              >
                Okton Fiscal Bot
              </Text>
            </HStack>

            <HStack gap="2" flex="1" minW="0">
              <Icon as={Building2} boxSize="4" color="fg.muted" flexShrink={0} />
              <NativeSelect.Root size="sm" maxW="240px">
                <NativeSelect.Field
                  value={companyId}
                  onChange={(event) => {
                    setCompanyId(event.currentTarget.value);
                    window.localStorage.setItem("okton.company", event.currentTarget.value);
                  }}
                >
                  <option value="all">Todas as empresas</option>
                  {(companies ?? []).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.razao_social}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>

            <HStack gap="3">
              <Badge
                variant="outline"
                size="sm"
                colorPalette="gray"
                textTransform="uppercase"
                display={{ base: "none", sm: "inline-flex" }}
              >
                {status?.environment ?? "—"}
              </Badge>
              <StatusDot label="Okton" online={!!status?.oktonOnline} />
              <StatusDot label="WhatsApp" online={!!status?.whatsappOnline} />
              <Text
                display={{ base: "none", xl: "inline" }}
                maxW="160px"
                truncate
                fontSize="xs"
                color="fg.muted"
              >
                {appUser?.name ?? user.email}
              </Text>
            </HStack>
          </Flex>
        </Box>

        <Box as="main" flex="1" minW="0">
          <Flex
            align="flex-end"
            justify="space-between"
            gap="4"
            borderBottomWidth="1px"
            borderColor="border"
            px={{ base: "4", lg: "6" }}
            py="6"
          >
            <Box minW="0">
              <Heading as="h1" size="2xl" fontFamily="heading" truncate>
                {title}
              </Heading>
              {description ? (
                <Text mt="1" fontSize="sm" color="fg.muted">
                  {description}
                </Text>
              ) : null}
            </Box>
            {actions}
          </Flex>
          <Box px={{ base: "4", lg: "6" }} py="6">
            {children}
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
}
