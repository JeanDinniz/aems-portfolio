import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] px-3 py-2 text-base text-[#111111] dark:text-white ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:outline-none focus-visible:border-[#F5A800] focus-visible:ring-4 focus-visible:ring-[rgba(245,168,0,0.15)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
