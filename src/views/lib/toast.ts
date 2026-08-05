import { toaster } from "@/views/components/Toaster";

type ToastOptions = {
  description?: string;
  duration?: number;
};

function show(
  type: "success" | "error" | "warning" | "info" | "loading",
  title: string,
  options?: ToastOptions,
) {
  return toaster.create({
    type,
    title,
    description: options?.description,
    duration: options?.duration,
    meta: { closable: true },
  });
}

/**
 * Wrapper fino sobre o toaster do Chakra UI v3, com a mesma ergonomia usada
 * pelas telas (`toast.success("...", { description })`).
 */
export const toast = {
  success: (title: string, options?: ToastOptions) => show("success", title, options),
  error: (title: string, options?: ToastOptions) => show("error", title, options),
  warning: (title: string, options?: ToastOptions) => show("warning", title, options),
  info: (title: string, options?: ToastOptions) => show("info", title, options),
  loading: (title: string, options?: ToastOptions) => show("loading", title, options),
  dismiss: (id?: string) => toaster.dismiss(id),
};
