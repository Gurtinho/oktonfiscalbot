import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";

import { system } from "@/views/theme";

export function Provider({ children }: { children: ReactNode }) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>;
}
