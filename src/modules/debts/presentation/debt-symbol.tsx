import { BookOpen, BriefcaseBusiness, Heart, House, ShoppingCart, Wallet } from "lucide-react";
import type { Debt } from "../domain/debt";

const icons = { wallet: Wallet, home: House, book: BookOpen, cart: ShoppingCart, heart: Heart, briefcase: BriefcaseBusiness };
export function DebtSymbol({ icon, size = 22 }: { icon: Debt["icon"]; size?: number }) {
  const Icon = icons[icon];
  return <Icon size={size} aria-hidden="true" />;
}
