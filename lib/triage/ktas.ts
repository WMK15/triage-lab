import type { KtasLevel } from "@/lib/triage/types";

export const KTAS_LABELS: Record<KtasLevel, string> = {
  1: "Immediate",
  2: "Very urgent",
  3: "Urgent",
  4: "Standard",
  5: "Non-urgent",
};

export function formatKtasLabel(level: number | null | undefined): string {
  if (level == null || !(level in KTAS_LABELS)) return "Unknown";
  return KTAS_LABELS[level as KtasLevel];
}
