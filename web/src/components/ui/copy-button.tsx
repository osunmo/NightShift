// From 21st.dev (@ncdai/copy-button). https://21st.dev/@ncdai/components/copy-button
// Adapted for a developer tool: the original also plays a sound (@rexa-developer/tiks) and triggers
// haptics (web-haptics) on copy; both are removed here. Everything else is the published component.
"use client"

import type { ComponentProps } from "react"
import { useCallback, useRef, useState } from "react"
import { CheckIcon, CircleXIcon, CopyIcon } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { IconSwap, IconSwapItem } from "@/components/ui/icon-swap"

export type CopyState = "idle" | "done" | "error"

export function useCopyToClipboard({
  onCopySuccess,
  onCopyError,
  resetDelay = 1500,
}: {
  onCopySuccess?: (text: string) => void
  onCopyError?: (error: Error) => void
  resetDelay?: number
} = {}) {
  const [state, setState] = useState<CopyState>("idle")
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copy = useCallback(
    async (text: string | (() => string)) => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current)
      try {
        const finalText = typeof text === "function" ? text() : text
        await navigator.clipboard.writeText(finalText)
        setState("done")
        onCopySuccess?.(finalText)
      } catch (error) {
        setState("error")
        onCopyError?.(error instanceof Error ? error : new Error("Copy failed"))
      } finally {
        resetTimeoutRef.current = setTimeout(() => setState("idle"), resetDelay)
      }
    },
    [onCopySuccess, onCopyError, resetDelay]
  )

  return { state, copy } as const
}

export type CopyStateIconProps = {
  state: CopyState
  idleIcon?: React.ReactNode
  doneIcon?: React.ReactNode
  errorIcon?: React.ReactNode
}

export function CopyStateIcon({ state, idleIcon, doneIcon, errorIcon }: CopyStateIconProps) {
  return (
    <IconSwap>
      <IconSwapItem key={state} as={motion.span}>
        {state === "idle" && (idleIcon ?? <CopyIcon data-slot="idle-icon" />)}
        {state === "done" && (doneIcon ?? <CheckIcon data-slot="done-icon" />)}
        {state === "error" && (errorIcon ?? <CircleXIcon data-slot="error-icon" />)}
      </IconSwapItem>
    </IconSwap>
  )
}

export type CopyButtonProps = ComponentProps<typeof Button> & {
  text: string | (() => string)
  onCopySuccess?: (text: string) => void
  onCopyError?: (error: Error) => void
} & Omit<CopyStateIconProps, "state">

export function CopyButton({
  className,
  size = "icon",
  children,
  text,
  idleIcon,
  doneIcon,
  errorIcon,
  onClick,
  onCopySuccess,
  onCopyError,
  ...props
}: CopyButtonProps) {
  const { state, copy } = useCopyToClipboard({ onCopySuccess, onCopyError })

  return (
    <Button
      className={cn("will-change-transform", className)}
      size={size}
      onClick={(e) => {
        copy(text)
        onClick?.(e)
      }}
      aria-label="Copy"
      {...props}
    >
      <CopyStateIcon state={state} idleIcon={idleIcon} doneIcon={doneIcon} errorIcon={errorIcon} />
      {children}
    </Button>
  )
}
