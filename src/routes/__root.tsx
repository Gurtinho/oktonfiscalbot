import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Box, Button, Center, Heading, Stack, Text } from "@chakra-ui/react";

import appCss from "../styles.css?url";
import { reportClientError } from "../lib/error-reporting";
import { Provider } from "@/views/components/Provider";
import { Toaster } from "@/views/components/Toaster";

function NotFoundComponent() {
  return (
    <Provider>
      <Center minH="100vh" bg="bg" px="4">
        <Stack gap="4" maxW="md" textAlign="center">
          <Heading as="h1" fontSize="7xl" fontFamily="heading">
            404
          </Heading>
          <Heading as="h2" size="lg">
            Página não encontrada
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            O endereço acessado não existe ou foi movido.
          </Text>
          <Box>
            <Button asChild colorPalette="green">
              <Link to="/">Voltar ao início</Link>
            </Button>
          </Box>
        </Stack>
      </Center>
    </Provider>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportClientError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <Provider>
      <Center minH="100vh" bg="bg" px="4">
        <Stack gap="4" maxW="md" textAlign="center">
          <Heading as="h1" size="lg">
            Esta página não carregou
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Algo deu errado do nosso lado. Tente novamente ou volte ao início.
          </Text>
          <Stack direction="row" gap="2" justify="center">
            <Button
              colorPalette="green"
              onClick={() => {
                router.invalidate();
                reset();
              }}
            >
              Tentar de novo
            </Button>
            <Button asChild variant="outline">
              <a href="/">Ir para o início</a>
            </Button>
          </Stack>
        </Stack>
      </Center>
    </Provider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Okton Fiscal Bot" },
      {
        name: "description",
        content:
          "Middleware entre o funil de WhatsApp e o ERP Okton para emissão guiada de NF-e, CT-e e MDF-e.",
      },
      { name: "author", content: "Okton Fiscal Bot" },
      { property: "og:title", content: "Okton Fiscal Bot" },
      {
        property: "og:description",
        content: "Emissão fiscal guiada por WhatsApp, com a Okton como fonte oficial.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <Provider>
      <QueryClientProvider client={queryClient}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster />
      </QueryClientProvider>
    </Provider>
  );
}
