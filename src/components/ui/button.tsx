import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-4 focus-visible:ring-sdr-500/20 focus-visible:border-sdr-500 active:translate-y-px",
  {
    variants: {
      variant: {
        default: "bg-sdr-600 text-white shadow-[0_10px_30px_rgba(11,138,97,.22)] hover:bg-sdr-700 hover:-translate-y-0.5",
        secondary: "border border-white/10 bg-white/8 text-white hover:bg-white/12",
        ghost: "text-white/72 hover:bg-white/8 hover:text-white",
        light: "border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-sdr-300 hover:text-sdr-700",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-5 text-sm",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props}/>;
}

export { buttonVariants };
