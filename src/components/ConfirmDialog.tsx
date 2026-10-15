"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="presentation" onMouseDown={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="w-full max-w-sm rounded-2xl border border-border/60 bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="confirm-dialog-title" className="text-base font-bold text-foreground">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-foreground/60">{description}</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close confirmation dialog" className="rounded-lg p-1 text-foreground/40 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-border/50 px-3 py-2 text-sm text-foreground/70 hover:bg-background/60">Cancel</button>
          <button ref={confirmRef} type="button" onClick={onConfirm} className="flex-1 rounded-xl bg-red/20 border border-red/30 px-3 py-2 text-sm font-semibold text-red hover:bg-red/30">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
