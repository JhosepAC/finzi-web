import {
  Baby, Banknote, Bed, Bike, Book, BookOpen, BriefcaseBusiness, Building2, Bus, Calculator, Camera, Car, ChartLine,
  Coffee, CreditCard, Dumbbell, Film, Folder, Fuel, Gamepad2, Gift, Globe, GraduationCap, HandCoins, Heart, HeartPulse,
  Home, Lamp, Laptop, Leaf, MapPin, Music, Palette, ParkingCircle, PartyPopper, PawPrint, Pencil, PiggyBank, Pill, Plane,
  Plug, Receipt, Repeat, ShieldCheck, Ship, Shirt, ShoppingBasket, ShoppingCart, Smartphone, Sofa, Sparkles, Star,
  Stethoscope, Sun, Tag, Tent, Ticket, TrainFront, Users, Utensils, Wallet, WashingMachine, Wifi, Wrench, type LucideIcon,
} from "lucide-react";
import type { CategoryIcon } from "../domain/category";

export const categoryIconComponents: Record<CategoryIcon, LucideIcon> = {
  tag: Tag, home: Home, sofa: Sofa, bed: Bed, lamp: Lamp, utensils: Utensils, coffee: Coffee,
  "shopping-basket": ShoppingBasket, cart: ShoppingCart, shirt: Shirt, "washing-machine": WashingMachine, wrench: Wrench, plug: Plug,
  car: Car, bus: Bus, "train-front": TrainFront, bike: Bike, plane: Plane, fuel: Fuel, "parking-circle": ParkingCircle, ship: Ship,
  heart: Heart, "heart-pulse": HeartPulse, stethoscope: Stethoscope, pill: Pill, dumbbell: Dumbbell, baby: Baby, "paw-print": PawPrint,
  book: Book, "book-open": BookOpen, "graduation-cap": GraduationCap, pencil: Pencil, laptop: Laptop, globe: Globe,
  briefcase: BriefcaseBusiness, wallet: Wallet, "credit-card": CreditCard, banknote: Banknote, "piggy-bank": PiggyBank, receipt: Receipt,
  calculator: Calculator, "chart-line": ChartLine, "hand-coins": HandCoins, "building-2": Building2,
  gift: Gift, "gamepad-2": Gamepad2, music: Music, film: Film, ticket: Ticket, palette: Palette, camera: Camera,
  "party-popper": PartyPopper, tent: Tent, "map-pin": MapPin,
  star: Star, sparkles: Sparkles, users: Users, smartphone: Smartphone, wifi: Wifi, "shield-check": ShieldCheck,
  leaf: Leaf, sun: Sun, repeat: Repeat, folder: Folder,
};
