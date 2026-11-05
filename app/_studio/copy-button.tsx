import type { ReactNode } from "react";
import { type CopyControl, copyLabel, copyState } from "./use-copy.ts";

export interface CopyButtonProps {
  copier: CopyControl;
  copyKey: string;
  text: string;
  idleLabel?: string;
  disabled?: boolean;
}

export function CopyButton({ copier, copyKey, text, idleLabel = "Copy", disabled = false }: CopyButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="copy-button"
      data-state={copyState(copier.feedback, copyKey)}
      disabled={disabled}
      onClick={() => copier.copy(copyKey, text)}
    >
      {copyLabel(copier.feedback, copyKey, idleLabel)}
    </button>
  );
}
