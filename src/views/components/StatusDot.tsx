import type { LucideIcon } from "lucide-react";
import { Box, HStack, Icon, Stack, Text } from "@chakra-ui/react";

export function StatusDot({
  label,
  online,
  title,
}: {
  label: string;
  online: boolean;
  title?: string;
}) {
  return (
    <HStack gap="1.5" title={title ?? (online ? `${label} online` : `${label} offline`)}>
      <Box position="relative" display="inline-flex" boxSize="2">
        <Box
          position="absolute"
          inset="0"
          rounded="full"
          bg={online ? "brand.solid" : "fg.muted"}
          opacity={online ? 0.4 : 0.25}
        />
        <Box
          position="relative"
          boxSize="2"
          rounded="full"
          bg={online ? "brand.solid" : "fg.muted"}
        />
      </Box>
      <Text fontSize="xs" color="fg.muted" display={{ base: "none", md: "inline" }}>
        {label}
      </Text>
    </HStack>
  );
}

const TONE_COLOR = {
  default: "fg",
  positive: "fg.brand",
  negative: "fg.danger",
  warning: "fg.warn",
} as const;

export type StatCardProps = {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONE_COLOR;
};

export function StatCard({ label, value, hint, icon, tone = "default" }: StatCardProps) {
  return (
    <Stack
      gap="3"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      rounded="l3"
      p="5"
      shadow="panel"
    >
      <HStack justify="space-between" align="start" gap="3">
        <Text fontSize="sm" color="fg.muted" lineClamp={2}>
          {label}
        </Text>
        <Icon as={icon} boxSize="4" color={TONE_COLOR[tone]} flexShrink={0} />
      </HStack>
      <Text fontFamily="heading" fontSize="3xl" fontWeight="bold" lineHeight="1">
        {value}
      </Text>
      {hint ? (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      ) : null}
    </Stack>
  );
}
