import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// Configuração independente (sem dependências da Lovable).
// O build gera um servidor Node autônomo (preset `node-server`),
// executável em qualquer VPS / App Platform / container (ex.: DigitalOcean).
export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Entrada SSR própria (wrapper de erros) em src/server.ts
      server: { entry: "server" },
    }),
    viteReact(),
    nitro({
      preset: process.env["NITRO_PRESET"] ?? "node-server",
      // A plataforma de build espera o artefato em `dist/`.
      output: { dir: process.env["NITRO_OUTPUT_DIR"] ?? "dist" },
    }),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  server: {
    host: "::",
    port: Number(process.env["PORT"] ?? 8080),
  },
  preview: {
    host: "::",
    port: Number(process.env["PORT"] ?? 8080),
  },
});
