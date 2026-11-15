"use client";
import Image from "next/image";
import { useState } from "react";
import { Tag } from "lucide-react";
import type { Category } from "../domain/category";
import { categoryIconComponents } from "./category-icon";
import { categoryImageUrl } from "./category-image";

export function CategorySymbol({ category, size = 20 }: { category?: Category; size?: number }) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const Icon = category ? categoryIconComponents[category.icon] : Tag;
  return category?.image_path && failedPath !== category.image_path
    ? <Image src={categoryImageUrl(category.image_path)} alt="" width={36} height={36} unoptimized onError={() => setFailedPath(category.image_path)} />
    : <Icon size={size} />;
}
