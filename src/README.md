# Estrutura do código — Okton Fiscal Bot (MVC)

## Model — `src/models/`

Contratos e regras de domínio isomórficas, sem segredos: contratos da Okton
(`okton-contract.ts`), coleta de campos (`field-collection.ts`), preenchimento
em bloco (`bulk-fill.ts`) e mascaramento de PII (`masking.ts`).
O acesso a dados usa os clientes gerados em `src/integrations/supabase/`.

## View — `src/views/` + `src/routes/`

- `src/views/components/` — componentes de UI (Chakra UI v3).
- `src/views/hooks/` — hooks React (auth, responsividade).
- `src/views/lib/`, `src/views/theme.ts` — helpers de UI e design system.
- `src/routes/` — páginas (roteamento por arquivo do TanStack Router).

## Controller — `src/controllers/`

`*.functions.ts` com `createServerFn`: valida entrada, autoriza e delega para os
serviços. É o único caminho pelo qual a View chama o servidor. Rotas em
`src/routes/api/public/**` são controllers HTTP públicos (webhooks).

## Services — `src/services/`

Lógica de servidor usada pelos controllers: cliente Okton, provedores de
WhatsApp, motor de conversa, webhooks, segurança/rate limit, IA de rejeições,
simulador e testador de API. Arquivos `*.server.ts` nunca vão ao bundle do
cliente; tokens e segredos só existem aqui.

## Infra

- `src/lib/` — utilitários de infraestrutura (captura e página de erro).
- `src/integrations/supabase/` — clientes gerados (browser, admin, middleware).
