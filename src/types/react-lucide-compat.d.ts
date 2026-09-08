import "react";
import type { LucideIcon as LucideIconType } from "lucide-react";

// Temporary type-only compatibility for the preview branch. This adds no runtime code.
declare module "react" {
  export type LucideIcon = LucideIconType;
}
