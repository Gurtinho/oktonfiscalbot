/**
 * Relato de erros do frontend.
 *
 * Implementação neutra (sem dependência de plataforma): registra no console e,
 * se existir, delega para um coletor externo instalado em
 * `window.__errorReporter` (ex.: Sentry, Logtail, endpoint próprio).
 */
type ErrorReporter = (payload: {
  message: string;
  stack?: string;
  route?: string;
  context?: Record<string, unknown>;
}) => void;

declare global {
  interface Window {
    __errorReporter?: ErrorReporter;
  }
}

export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  // Loaders e server fns costumam lançar um Response cru; String(it) vira
  // "[object Response]", então extraímos status e URL.
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  console.error("[client-error]", message, { route: window.location.pathname, ...context });

  window.__errorReporter?.({
    message,
    stack: error instanceof Error ? error.stack : undefined,
    route: window.location.pathname,
    context,
  });
}
