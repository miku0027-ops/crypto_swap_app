import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { chainFor, tokenFor } from "../lib/data";
export function TokenIcon({
  symbol,
  size = 36,
  chainId,
}: {
  symbol: string;
  size?: number;
  chainId?: number;
}) {
  const token = tokenFor(symbol);
  return (
    <span aria-hidden="true" className="asset-icon-wrap" style={{ width: size, height: size }}>
      <span
        className="token-avatar"
        style={{
          background: token.color,
          width: size,
          height: size,
          fontSize: size * 0.5,
        }}
      >
        {symbol === "ETH" ? (
          <svg viewBox="0 0 24 32" width="55%" height="78%" aria-hidden="true">
            <path d="M12 0 0 17l12 7 12-7z" fill="white" />
            <path d="M12 0v24l12-7z" fill="#cdd5f6" />
            <path d="m0 20 12 12 12-12-12 7z" fill="white" />
          </svg>
        ) : symbol === "USDC" ? (
          "$"
        ) : symbol === "USDT" ? (
          "₮"
        ) : symbol === "WBTC" ? (
          "₿"
        ) : symbol === "SOL" ? (
          "≋"
        ) : symbol === "DAI" ? (
          "◈"
        ) : symbol === "AVAX" ? (
          "▲"
        ) : (
          "◇"
        )}
      </span>
      {chainId && (
        <span
          className="asset-chain"
          style={{ background: chainFor(chainId).color }}
        >
          {chainFor(chainId).symbol}
        </span>
      )}
    </span>
  );
}
export function ChainIcon({ id, size = 24 }: { id: number; size?: number }) {
  const c = chainFor(id);
  return (
    <span
      aria-hidden="true" className="chain-icon"
      style={{
        width: size,
        height: size,
        background: c.color,
        fontSize: size * 0.48,
      }}
    >
      {c.symbol}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.removeEventListener("keydown", handler);
      prior?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
