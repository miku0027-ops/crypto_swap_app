import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Menu,
  Moon,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import {
  NAVIGATION_SECTIONS,
  PRIMARY_NAVIGATION,
  pageHref,
} from "../lib/navigation";
import type { NavigationPage } from "../lib/navigation";
import "./navigation.css";

type Props = {
  page: NavigationPage;
  experience: "live" | "demo";
  walletLabel?: string;
  onNavigate: (page: NavigationPage) => void;
  onExperience: (mode: "live" | "demo") => void;
  onWallet: () => void;
  onTheme: (theme: "light" | "dark") => void;
};
function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="hoplane-brand"
      onClick={onClick}
      aria-label="Hoplane home"
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="M4 26 20 7h13L17 26zm12 8L31 16h7L23 34z"
          fill="currentColor"
        />
      </svg>
      <span>hoplane</span>
    </button>
  );
}
export default function AppNavigation({
  page,
  experience,
  walletLabel,
  onNavigate,
  onExperience,
  onWallet,
  onTheme,
}: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const activeSection = NAVIGATION_SECTIONS.find((section) =>
    section.items.some((item) => item.page === page),
  );
  useEffect(() => {
    const sync = () =>
      setTheme(
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      );
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    sync();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setOpen(false);
    setExpanded(null);
  }, [page, experience]);
  useEffect(() => {
    if (!open) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],[tabindex="0"]',
        ) ?? [],
      );
      const first = items[0],
        last = items.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !panel.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", handle);
      trigger.current?.focus();
    };
  }, [open]);
  function navigate(
    event: MouseEvent<HTMLAnchorElement>,
    next: NavigationPage,
  ) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setOpen(false);
    onNavigate(next);
  }
  const modes = (
    <div
      className="hoplane-mode-switch"
      role="group"
      aria-label="Experience mode"
    >
      {(["live", "demo"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-label={`${mode === "live" ? "Live" : "Demo"} mode`}
          aria-pressed={experience === mode}
          onClick={() => {
            setOpen(false);
            onExperience(mode);
          }}
        >
          {mode === "live" ? "Live" : "Demo"}
          {experience === mode && <Check size={12} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header
        className="hoplane-header"
        aria-hidden={open || undefined}
        inert={open || undefined}
      >
        <Brand onClick={() => onNavigate("swap")} />
        <nav className="hoplane-primary-nav" aria-label="Main navigation">
          {PRIMARY_NAVIGATION.map((item) => (
            <a
              key={item.page}
              href={pageHref(item.page)}
              className={page === item.page ? "active" : ""}
              aria-current={page === item.page ? "page" : undefined}
              onClick={(event) => navigate(event, item.page)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hoplane-header-actions">
          <div className="hoplane-desktop-mode">{!open && modes}</div>
          <button
            className="hoplane-wallet-button"
            onClick={onWallet}
            aria-label={
              experience === "live"
                ? "Account"
                : walletLabel || "Connect wallet"
            }
          >
            <Wallet size={17} />
            <span>
              {experience === "live"
                ? "Account"
                : walletLabel || "Connect wallet"}
            </span>
          </button>
          <button
            className="hoplane-menu-trigger"
            ref={trigger}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls="hoplane-navigation-panel"
            onClick={() => {
              setExpanded(activeSection?.label ?? null);
              setOpen(true);
            }}
          >
            <Menu size={23} />
            <span>Menu</span>
          </button>
        </div>
      </header>
      {open && (
        <div
          className="hoplane-menu-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            id="hoplane-navigation-panel"
            className="hoplane-menu-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Explore Hoplane"
            ref={panel}
          >
            <div className="hoplane-menu-header">
              <Brand
                onClick={() => {
                  setOpen(false);
                  onNavigate("swap");
                }}
              />
              <div className="hoplane-menu-header-actions">
                <button
                  className="hoplane-wallet-button"
                  onClick={() => {
                    setOpen(false);
                    onWallet();
                  }}
                  aria-label={
                    experience === "live"
                      ? "Account"
                      : walletLabel || "Connect wallet"
                  }
                >
                  <Wallet size={17} />
                  <span>
                    {experience === "live"
                      ? "Account"
                      : walletLabel || "Connect wallet"}
                  </span>
                </button>
                <button
                  className="hoplane-menu-close"
                  aria-label="Close navigation"
                  ref={closeButton}
                  onClick={() => setOpen(false)}
                >
                  <X size={24} />
                </button>
              </div>
            </div>
            <nav className="hoplane-menu-nav" aria-label="All navigation">
              <div className="hoplane-menu-primary">
                {PRIMARY_NAVIGATION.map((item) => (
                  <a
                    key={item.page}
                    href={pageHref(item.page)}
                    aria-current={page === item.page ? "page" : undefined}
                    onClick={(event) => navigate(event, item.page)}
                  >
                    <span>{item.label}</span>
                    {page === item.page && (
                      <span
                        className="hoplane-current-dot"
                        aria-hidden="true"
                      />
                    )}
                  </a>
                ))}
              </div>
              {NAVIGATION_SECTIONS.map((section) => {
                const id = `hoplane-section-${section.label.toLowerCase().replaceAll(" ", "-")}`,
                  selected = section.items.some((item) => item.page === page),
                  isOpen = expanded === section.label;
                return (
                  <section className="hoplane-menu-section" key={section.label}>
                    <button
                      className={`hoplane-section-trigger${selected ? " active" : ""}`}
                      aria-expanded={isOpen}
                      aria-controls={id}
                      onClick={() => setExpanded(isOpen ? null : section.label)}
                    >
                      {section.label}
                      <ChevronDown
                        size={20}
                        className={isOpen ? "rotated" : ""}
                      />
                    </button>
                    {isOpen && (
                      <div id={id} className="hoplane-menu-links">
                        {section.items.map((item) => (
                          <a
                            key={item.page}
                            href={pageHref(item.page)}
                            aria-current={
                              page === item.page ? "page" : undefined
                            }
                            onClick={(event) => navigate(event, item.page)}
                          >
                            <span>
                              <strong>{item.label}</strong>
                              <small>{item.description}</small>
                            </span>
                            <ArrowUpRight size={17} aria-hidden="true" />
                          </a>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </nav>
            <div className="hoplane-menu-footer">
              <div>
                <span className="hoplane-preference-label">Experience</span>
                {modes}
              </div>
              <div>
                <span className="hoplane-preference-label">Appearance</span>
                <div
                  className="hoplane-theme-switch"
                  role="group"
                  aria-label="Appearance"
                >
                  <button
                    aria-label="Use light appearance"
                    aria-pressed={theme === "light"}
                    onClick={() => onTheme("light")}
                  >
                    <Sun size={19} />
                    <span>Light</span>
                  </button>
                  <button
                    aria-label="Use dark appearance"
                    aria-pressed={theme === "dark"}
                    onClick={() => onTheme("dark")}
                  >
                    <Moon size={19} />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
              <p>
                {experience === "demo"
                  ? "Demo · simulated balances and transfers"
                  : "Live · services follow deployment availability"}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
