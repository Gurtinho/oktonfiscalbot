# Okton Fiscal Bot

Middleware entre um funil de WhatsApp e o sistema Okton. O projeto é
autocontido: não depende de nenhum serviço proprietário de plataforma e pode
ser executado em qualquer host Node (DigitalOcean App Platform, Droplet,
Docker, etc.).

## Desenvolvimento

```sh
git clone <this-repository-url>
cd <repository-name>
cp .env.example .env   # preencha as variáveis
npm install
npm run dev            # http://localhost:8080
```

## Build e execução em produção

```sh
npm run build
node dist/server/index.mjs
```

Deploy detalhado (App Platform, Docker, webhooks, banco): ver [DEPLOY.md](./DEPLOY.md).

## Stack

- TanStack Start (React 19 + TypeScript) com SSR
- Nitro (preset `node-server`) para o servidor autônomo
- Chakra UI v3 + Zod
- Supabase (banco, auth, RLS) — cloud ou self-hosted

## Estrutura

- `src/controllers` — controllers RPC (`createServerFn`), ponte UI → serviços
- `src/services` — regras de negócio e integrações (`*.server.ts`, somente servidor)
- `src/models` — modelos/contratos isomórficos (Okton, campos, mascaramento)
- `src/views` — camada de apresentação (componentes, hooks, tema)
- `src/routes` — roteamento e páginas (file-based)
- `src/routes` — rotas e endpoints HTTP
- `supabase/migrations` — schema do banco
