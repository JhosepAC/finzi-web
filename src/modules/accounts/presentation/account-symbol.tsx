import { Building2, Wallet } from "lucide-react";
import type { Account } from "../domain/account";

export function AccountSymbol({ type, size = 21 }: { type: Account["type"]; size?: number }) {
  const Icon = type === "bank" ? Building2 : Wallet;
  return <Icon size={size} aria-hidden="true" />;
}
