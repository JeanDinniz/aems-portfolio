import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-aems-primary-400 text-aems-neutral-900 hover:bg-aems-primary-600",
        secondary:
          "border-transparent bg-aems-neutral-100 text-aems-neutral-600 hover:bg-aems-neutral-200",
        destructive:
          "border-transparent bg-aems-error text-white hover:bg-aems-error/80",
        outline: "text-foreground",
        active: "border-transparent bg-[rgba(18,183,106,0.1)] text-[#12B76A]",
        attention: "border-transparent bg-[rgba(247,144,9,0.1)] text-[#F79009]",
        critical: "border-transparent bg-[rgba(240,68,56,0.1)] text-[#F04438]",
        exhausted: "border-transparent bg-[rgba(102,112,133,0.1)] text-[#667085]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
