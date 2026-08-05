# Deploy na DigitalOcean

O projeto não depende mais de nenhum serviço da Lovable. O build gera um
servidor Node autônomo (Nitro, preset `node-server`) em `dist/`.

## 1. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. Variáveis `VITE_*` entram no
bundle do navegador (são públicas); as demais ficam apenas no servidor.

## 2. Build local

```bash
bun install        # ou npm install
bun run build
node dist/server/index.mjs
```

A aplicação sobe em `http://localhost:8080` (configurável por `PORT`).

## 3. DigitalOcean App Platform

- Origem: repositório Git.
- Build command: `npm install && npm run build`
- Run command: `node dist/server/index.mjs`
- HTTP port: `8080`
- Cadastre as variáveis de ambiente do `.env.example` (marque as sensíveis
  como *encrypted*).

## 4. Droplet / Docker

```bash
docker build -t okton-fiscal-bot .
docker run -d --env-file .env -p 80:8080 okton-fiscal-bot
```

Recomendado colocar um Nginx/Caddy na frente para TLS.

## 5. Webhooks

Atualize as URLs públicas nos provedores para o seu domínio:

- WhatsApp: `https://SEU_DOMINIO/api/public/whatsapp/<token>`
- Okton: `https://SEU_DOMINIO/webhooks/okton/fiscal`

## 6. Banco de dados

As migrações ficam em `supabase/migrations` e podem ser aplicadas com o
Supabase CLI (`supabase db push`) tanto em Supabase Cloud quanto em uma
instância self-hosted em um Droplet.
