import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  ExternalLink,
  Globe2,
  History,
  Info,
  Layers,
  Loader2,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Wallet as WalletIcon,
  X,
  Zap,
  CreditCard,
  Landmark,
  RefreshCw,
  LogOut,
  Compass,
} from "lucide-react";
import { Modal, TokenIcon, ChainIcon } from "./components/Primitives";
import {
  ExploreView,
  ActivityView,
  PortfolioView,
  HelpView,
} from "./components/SecondaryViews";
import {
  CHAINS,
  chainFor,
  tokenFor,
  tokensForChain,
  demoBalance,
  money,
  shortAddress,
} from "./lib/data";
import {
  previewQuote,
  saveStored,
  validAmount,
  validRecipient,
} from "./lib/trade";
import { loadSettings, loadActivity, loadFavorites } from "./lib/storage";
import type { Asset, Settings, Wallet, Activity } from "./lib/types";
type Page = "swap" | "explore" | "activity" | "portfolio" | "help";
type Dialog =
  | "wallet"
  | "settings"
  | "from"
  | "to"
  | "review"
  | "account"
  | "progress"
  | null;
type Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (name: string, callback: (accounts: string[]) => void) => void;
  removeListener?: (
    name: string,
    callback: (accounts: string[]) => void,
  ) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
const defaultAsset = (side: "from" | "to"): Asset => {
  const q = new URLSearchParams(location.search);
  const id = Number(q.get(side === "from" ? "fromChainId" : "toChainId"));
  const chainId = CHAINS.some((c) => c.id === id)
    ? id
    : side === "from"
      ? 1
      : 8453;
  const symbol =
    q.get(side === "from" ? "fromToken" : "toToken") ||
    (side === "from" ? "ETH" : "USDC");
  return {
    chainId,
    symbol: tokensForChain(chainId).some((t) => t.symbol === symbol)
      ? symbol
      : tokensForChain(chainId)[0].symbol,
  };
};
export default function App() {
  const [page, setPage] = useState<Page>("swap"),
    [mode, setMode] = useState<"swap" | "buy" | "sell">("swap"),
    [dialog, setDialog] = useState<Dialog>(null),
    [mobileNav, setMobileNav] = useState(false);
  const [from, setFrom] = useState<Asset>(() => defaultAsset("from")),
    [to, setTo] = useState<Asset>(() => defaultAsset("to")),
    [amount, setAmount] = useState("0.1");
  const [wallet, setWallet] = useState<Wallet | null>(null),
    [walletError, setWalletError] = useState(""),
    [connecting, setConnecting] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings),
    [activity, setActivity] = useState<Activity[]>(loadActivity),
    [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [recipientOpen, setRecipientOpen] = useState(false),
    [recipient, setRecipient] = useState(""),
    [routeOpen, setRouteOpen] = useState(false),
    [toast, setToast] = useState(""),
    [progress, setProgress] = useState(0),
    [lastActivity, setLastActivity] = useState<Activity | null>(null);
  const [fiat, setFiat] = useState("USD"),
    [fiatAmount, setFiatAmount] = useState("100"),
    [payment, setPayment] = useState("card");
  const closeDialog = useCallback(() => setDialog(null), []);
  const q = useMemo(
    () => previewQuote(amount, from, to, settings.slippage),
    [amount, from, to, settings.slippage],
  );
  const sameAsset = from.chainId === to.chainId && from.symbol === to.symbol;
  const recipientError =
    recipientOpen && !validRecipient(recipient, to.chainId);
  const amountError =
    amount !== "" && !validAmount(amount)
      ? "Enter an amount greater than zero."
      : wallet?.type === "demo" && Number(amount) > demoBalance(from.symbol)
        ? "Amount exceeds the sample balance."
        : "";
  useEffect(() => {
    saveStored("hoplane.settings", settings);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);
  useEffect(() => {
    saveStored("hoplane.activity", activity);
  }, [activity]);
  useEffect(() => {
    saveStored("hoplane.favorites", favorites);
  }, [favorites]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const update = (accounts: string[]) =>
      setWallet((prev) =>
        prev?.type === "injected"
          ? accounts.length
            ? { ...prev, address: accounts[0] }
            : null
          : prev,
      );
    window.ethereum?.on?.("accountsChanged", update);
    return () => window.ethereum?.removeListener?.("accountsChanged", update);
  }, []);
  const navigate = (next: Page) => {
    setPage(next);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const pickAsset = (asset: Asset) => {
    setTo(asset);
    setPage("swap");
    setMode("swap");
    setToast(
      `Destination set to ${asset.symbol} on ${chainFor(asset.chainId).name}`,
    );
  };
  const notify = (message: string) => setToast(message);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify("Copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the address.");
    }
  };
  const connect = async () => {
    if (!window.ethereum) {
      setWalletError(
        "No browser wallet detected. Install an Ethereum-compatible wallet, then reload this page, or explore the demo below.",
      );
      return;
    }
    setConnecting(true);
    setWalletError("");
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      if (!accounts?.[0]) throw Error("No account was selected.");
      setWallet({
        address: accounts[0],
        type: "injected",
        name: window.ethereum.isMetaMask
          ? "MetaMask"
          : window.ethereum.isCoinbaseWallet
            ? "Coinbase Wallet"
            : "Browser wallet",
      });
      setDialog(null);
      notify("Wallet connected. Transfers remain in preview mode.");
    } catch (e) {
      setWalletError(
        e instanceof Error
          ? e.message
          : "Wallet connection was declined. Please try again.",
      );
    } finally {
      setConnecting(false);
    }
  };
  const swapDirection = () => {
    setFrom(to);
    setTo(from);
    setAmount(
      q.out > 0
        ? q.out.toFixed(to.symbol === "USDC" || to.symbol === "USDT" ? 2 : 6)
        : "",
    );
  };
  const startSimulation = () => {
    setDialog("progress");
    setProgress(0);
  };
  useEffect(() => {
    if (dialog !== "progress" || progress >= 3) return;
    const timer = setTimeout(() => setProgress((v) => v + 1), 1100);
    return () => clearTimeout(timer);
  }, [dialog, progress]);
  useEffect(() => {
    if (dialog === "progress" && progress === 3) {
      const record: Activity = {
        id: `demo-${crypto.randomUUID()}`,
        from,
        to,
        amount,
        received: q.out.toFixed(
          to.symbol === "USDC" || to.symbol === "USDT" ? 2 : 6,
        ),
        timestamp: Date.now(),
        status: "completed",
        mode: "demo",
        recipient: recipientOpen ? recipient : wallet?.address || "Demo wallet",
      };
      setLastActivity(record);
      setActivity((prev) => [record, ...prev].slice(0, 100));
    }
  }, [progress]);
  const renderAmount = (side: "from" | "to") => {
    const asset = side === "from" ? from : to;
    return (
      <div className={`amount-box ${side === "to" ? "receive-box" : ""}`}>
        <div className="amount-label">
          <span>{side === "from" ? "You pay" : "You receive"}</span>
          {side === "from" ? (
            <button
              className="text-button"
              onClick={() => setDialog(wallet ? "account" : "wallet")}
            >
              <WalletIcon size={13} />
              {wallet ? shortAddress(wallet.address) : "Select wallet"}
              <ChevronDown size={12} />
            </button>
          ) : (
            <button
              className="text-button"
              onClick={() => setRecipientOpen((v) => !v)}
            >
              {recipientOpen ? "Custom recipient" : "Same wallet"}
              <ChevronDown size={12} />
            </button>
          )}
        </div>
        <div className="amount-main">
          <input
            aria-label={
              side === "from" ? "Amount to send" : "Amount to receive"
            }
            inputMode="decimal"
            placeholder="0"
            value={
              side === "from"
                ? amount
                : q.out > 0
                  ? q.out.toFixed(
                      ["USDC", "USDT", "DAI"].includes(to.symbol) ? 2 : 6,
                    )
                  : ""
            }
            onChange={(e) => {
              const val = e.target.value;
              if (!/^\d*\.?\d*$/.test(val)) return;
              if (side === "from") setAmount(val);
              else
                setAmount(
                  val
                    ? (
                        (Number(val) * tokenFor(to.symbol).price) /
                        (tokenFor(from.symbol).price * 0.9965)
                      ).toFixed(8)
                    : "",
                );
            }}
          />
          <button className="asset-select" aria-label={`Select ${side === 'from' ? 'source' : 'destination'} token: ${asset.symbol} on ${chainFor(asset.chainId).name}`} onClick={() => setDialog(side)}>
            <TokenIcon
              symbol={asset.symbol}
              chainId={asset.chainId}
              size={35}
            />
            <span>
              <strong>{asset.symbol}</strong>
              <small>{chainFor(asset.chainId).name}</small>
            </span>
            <ChevronDown size={17} />
          </button>
        </div>
        <div className="amount-meta">
          <span>
            {money(side === "from" ? q.usd : q.out * tokenFor(to.symbol).price)}
          </span>
          {side === "from" && wallet?.type === "demo" ? (
            <span className="balance">
              Balance: {demoBalance(from.symbol)}
              <button
                onClick={() =>
                  setAmount(String(demoBalance(from.symbol) * 0.5))
                }
              >
                50%
              </button>
              <button
                onClick={() => setAmount(String(demoBalance(from.symbol)))}
              >
                MAX
              </button>
            </span>
          ) : side === "to" ? (
            <span className="estimate-tag">Estimated</span>
          ) : (
            <span>Enter an amount</span>
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          className="brand"
          onClick={() => navigate("swap")}
          aria-label="Hoplane home"
        >
          <span className="brand-mark">
            <svg viewBox="0 0 40 40">
              <path
                d="M4 26 20 7h13L17 26zm12 8L31 16h7L23 34z"
                fill="currentColor"
              />
            </svg>
          </span>
          hoplane
        </button>
        <nav
          className={mobileNav ? "main-nav open" : "main-nav"}
          aria-label="Main navigation"
        >
          {(["swap", "explore", "activity", "portfolio"] as Page[]).map(
            (item) => (
              <button
                key={item}
                className={page === item ? "nav-link active" : "nav-link"}
                onClick={() => navigate(item)}
              >
                {item === "swap"
                  ? "Swap & bridge"
                  : item[0].toUpperCase() + item.slice(1)}
              </button>
            ),
          )}
          <button
            className="nav-link mobile-help"
            onClick={() => navigate("help")}
          >
            Help
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="network-status"
            onClick={() => setDialog("settings")}
          >
            <span />
            {settings.testnet ? "Testnet preview" : "Mainnet preview"}
            <ChevronDown size={12} />
          </button>
          <button
            className="header-wallet"
            onClick={() => setDialog(wallet ? "account" : "wallet")}
          >
            <WalletIcon size={16} />
            <span>
              {wallet ? shortAddress(wallet.address) : "Connect wallet"}
            </span>
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav((v) => !v)}
          >
            {mobileNav ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main>
        {page === "swap" ? (
          <>
            <div className="hero">
              <div className="eyebrow hero-eyebrow">
                <span className="tiny-star">✳</span> LESS FRICTION. MORE
                FREEDOM.
              </div>
              <h1>
                Your crypto.<span> Everywhere.</span>
              </h1>
              <p>Swap tokens. Cross chains. Take the next step.</p>
            </div>
            <div className="trading-scene">
              <div className="orbit-art orbit-left" aria-hidden="true">
                <div className="orbit-ring ring-one" />
                <div className="orbit-ring ring-two" />
                <div className="floating-token eth-float">
                  <TokenIcon symbol="ETH" size={58} />
                </div>
                <div className="floating-token usdc-float">
                  <TokenIcon symbol="USDC" size={42} />
                </div>
                <div className="orbit-note">
                  <span className="tiny-star">✳</span>
                  <span>
                    One small hop.
                    <br />
                    <strong>A whole new chain.</strong>
                  </span>
                </div>
              </div>
              <section className="trade-card" aria-label="Swap and bridge">
                <div className="trade-card-header">
                  <div
                    className="trade-tabs"
                    role="tablist"
                    aria-label="Transaction type"
                  >
                    {(["swap", "buy", "sell"] as const).map((t) => (
                      <button
                        role="tab"
                        aria-selected={mode === t}
                        className={mode === t ? "selected" : ""}
                        key={t}
                        onClick={() => setMode(t)}
                      >
                        {t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="trade-tools">
                    <button
                      className="icon-button"
                      aria-label="Transaction history"
                      onClick={() => navigate("activity")}
                    >
                      <History size={18} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Swap settings"
                      onClick={() => setDialog("settings")}
                    >
                      <Settings2 size={18} />
                    </button>
                  </div>
                </div>
                {mode === "swap" ? (
                  <>
                    <div className="amount-fields">
                      {renderAmount("from")}
                      <button
                        className="switch-direction"
                        aria-label="Reverse swap direction"
                        onClick={swapDirection}
                      >
                        <ArrowDown size={18} />
                      </button>
                      {renderAmount("to")}
                    </div>
                    {recipientOpen && (
                      <div className="recipient-field">
                        <label htmlFor="recipient">
                          Recipient address{" "}
                          <span>{chainFor(to.chainId).name}</span>
                        </label>
                        <div>
                          <input
                            id="recipient"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder={
                              to.chainId === 792703809
                                ? "Solana address"
                                : "0x…"
                            }
                            autoComplete="off"
                          />
                          <button
                            className="icon-button"
                            aria-label="Remove custom recipient"
                            onClick={() => {
                              setRecipientOpen(false);
                              setRecipient("");
                            }}
                          >
                            <X size={16} />
                          </button>
                        </div>
                        {recipient && recipientError && (
                          <small className="error-text">
                            Enter a valid {chainFor(to.chainId).name} address.
                          </small>
                        )}
                      </div>
                    )}
                    <div className="quote-summary">
                      <button onClick={() => setRouteOpen((v) => !v)}>
                        <span className="quote-rate">
                          1 {from.symbol} ≈{" "}
                          {q.rate.toLocaleString("en-US", {
                            maximumFractionDigits: 4,
                          })}{" "}
                          {to.symbol}
                        </span>
                        <ChevronDown
                          className={routeOpen ? "rotated" : ""}
                          size={14}
                        />
                      </button>
                      <div className="route-tags">
                        <span>
                          <Zap size={12} />
                          {q.seconds}s
                        </span>
                        <span>
                          <Layers size={12} />
                          {money(q.fee)}
                        </span>
                      </div>
                    </div>
                    {routeOpen && (
                      <div className="route-details">
                        <div>
                          <span>Route</span>
                          <strong>
                            {chainFor(from.chainId).name}
                            <ArrowRight size={12} />
                            {chainFor(to.chainId).name}
                          </strong>
                        </div>
                        <div>
                          <span>Estimated fees</span>
                          <strong>{money(q.fee)}</strong>
                        </div>
                        <div>
                          <span>Minimum received</span>
                          <strong>
                            {q.minimum.toFixed(6)} {to.symbol}
                          </strong>
                        </div>
                        <div>
                          <span>Slippage tolerance</span>
                          <button
                            className="text-button"
                            onClick={() => setDialog("settings")}
                          >
                            {settings.slippage === "auto"
                              ? "Auto (0.5%)"
                              : `${settings.slippage}%`}
                          </button>
                        </div>
                        <p>
                          Illustrative prices, fees, and timing. Live quotes
                          will come from Relay once the backend is configured.
                        </p>
                      </div>
                    )}
                    {(amountError || sameAsset) && (
                      <p className="form-error" role="alert">
                        {sameAsset
                          ? "Choose a different token or destination network."
                          : amountError}
                      </p>
                    )}
                    <button
                      className="primary-button trade-cta"
                      disabled={
                        !!wallet &&
                        (!validAmount(amount) ||
                          !!amountError ||
                          sameAsset ||
                          recipientError)
                      }
                      onClick={() => setDialog(wallet ? "review" : "wallet")}
                    >
                      {wallet ? "Review preview" : "Connect wallet"}
                      <ArrowRight size={17} />
                    </button>
                    <div className="quote-disclaimer">
                      <span className="preview-dot" />
                      Preview mode · No funds move
                      <CircleHelp size={13} />
                    </div>
                  </>
                ) : (
                  <div className="fiat-form">
                    <div className="amount-box">
                      <div className="amount-label">
                        {mode === "buy" ? "You pay" : "You sell"}
                      </div>
                      <div className="amount-main">
                        <input
                          aria-label="Fiat amount"
                          inputMode="decimal"
                          value={fiatAmount}
                          onChange={(e) => {
                            if (/^\d*\.?\d*$/.test(e.target.value))
                              setFiatAmount(e.target.value);
                          }}
                        />
                        <select
                          aria-label="Fiat currency"
                          value={fiat}
                          onChange={(e) => setFiat(e.target.value)}
                        >
                          <option>USD</option>
                          <option>EUR</option>
                          <option>GBP</option>
                          <option>INR</option>
                        </select>
                      </div>
                    </div>
                    <div className="fiat-asset">
                      <span>
                        {mode === "buy" ? "Receive crypto" : "Sell crypto"}
                      </span>
                      <button
                        className="asset-select"
                        onClick={() => setDialog("to")}
                      >
                        <TokenIcon symbol={to.symbol} size={30} />
                        <strong>{to.symbol}</strong>
                        <small>{chainFor(to.chainId).name}</small>
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    <label className="field-label">
                      {mode === "buy" ? "Pay with" : "Payout to"}
                    </label>
                    <div className="payment-options">
                      <button
                        className={payment === "card" ? "selected" : ""}
                        onClick={() => setPayment("card")}
                      >
                        <CreditCard size={20} />
                        {mode === "buy" ? "Debit / credit card" : "Debit card"}
                        {payment === "card" && <Check size={15} />}
                      </button>
                      <button
                        className={payment === "bank" ? "selected" : ""}
                        onClick={() => setPayment("bank")}
                      >
                        <Landmark size={20} />
                        Bank transfer{payment === "bank" && <Check size={15} />}
                      </button>
                    </div>
                    <div className="info-box">
                      <Info size={17} />
                      <span>
                        Fiat {mode === "buy" ? "purchases" : "withdrawals"} need
                        a payment provider. Supported countries, fees, and
                        identity verification will be shown before you continue.
                      </span>
                    </div>
                    <button className="primary-button trade-cta" disabled>
                      Provider integration coming next
                    </button>
                    <p className="quote-disclaimer">
                      No payment details are collected in this preview.
                    </p>
                  </div>
                )}
              </section>
              <div className="orbit-art orbit-right" aria-hidden="true">
                <div className="orbit-ring ring-three" />
                <div className="floating-token sol-float">
                  <TokenIcon symbol="SOL" size={55} />
                </div>
                <div className="floating-chain">
                  <ChainIcon id={8453} size={46} />
                </div>
                <div className="network-note">
                  <div className="mini-avatars">
                    {[1, 8453, 42161].map((id) => (
                      <ChainIcon key={id} id={id} size={20} />
                    ))}
                  </div>
                  <strong>
                    Different chains.
                    <br />
                    Same possibilities.
                  </strong>
                  <span>Built to move with you ↗</span>
                </div>
              </div>
            </div>
            <div className="trade-benefits">
              <span>
                <ShieldCheck size={15} />
                Your keys, your crypto
              </span>
              <i />
              <span>
                <Zap size={15} />
                One simple experience
              </span>
              <i />
              <span>
                <Globe2 size={15} />
                Built for everywhere
              </span>
            </div>
            <section className="networks-strip">
              <span>EXPLORE THE ECOSYSTEM</span>
              <div>
                {CHAINS.slice(0, 6).map((c) => (
                  <button
                    key={c.id}
                    onClick={() =>
                      pickAsset({
                        chainId: c.id,
                        symbol: tokensForChain(c.id)[0].symbol,
                      })
                    }
                  >
                    <ChainIcon id={c.id} size={23} />
                    {c.name}
                  </button>
                ))}
                <button
                  className="all-networks"
                  onClick={() => navigate("explore")}
                >
                  View all
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
            <section className="feature-strip">
              <button
                className="feature-card"
                onClick={() => navigate("explore")}
              >
                <span className="feature-icon">
                  <Compass size={21} />
                </span>
                <div>
                  <strong>Your next destination</strong>
                  <p>Find your way around the multichain world.</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
              <button
                className="feature-card"
                onClick={() => navigate("portfolio")}
              >
                <span className="feature-icon lavender">
                  <WalletIcon size={20} />
                </span>
                <div>
                  <strong>One place for your crypto</strong>
                  <p>Explore balances across your favorite networks.</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
              <button className="feature-card" onClick={() => navigate("help")}>
                <span className="feature-icon peach">
                  <Sparkles size={20} />
                </span>
                <div>
                  <strong>New to bridging?</strong>
                  <p>A little guidance goes a long way.</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
            </section>
          </>
        ) : page === "explore" ? (
          <ExploreView onSelect={pickAsset} />
        ) : page === "activity" ? (
          <ActivityView activity={activity} />
        ) : page === "portfolio" ? (
          <PortfolioView
            wallet={wallet}
            onConnect={() => setDialog("wallet")}
            onSwap={(asset) => {
              setFrom(asset);
              navigate("swap");
            }}
          />
        ) : (
          <HelpView />
        )}
      </main>
      <footer className="site-footer">
        <div>
          <span className="footer-dot" />
          Hoplane preview<span className="footer-divider">/</span>
          <span>Made for your next move.</span>
        </div>
        <div>
          <button onClick={() => navigate("help")}>
            Help center
            <ArrowUpRight size={12} />
          </button>
          <a href="https://docs.relay.link" target="_blank" rel="noreferrer">
            Relay docs
            <ArrowUpRight size={12} />
          </a>
          <button
            className="theme-button"
            aria-label={`Switch to ${settings.theme === "light" ? "dark" : "light"} theme`}
            onClick={() =>
              setSettings((s) => ({
                ...s,
                theme: s.theme === "light" ? "dark" : "light",
              }))
            }
          >
            {settings.theme === "light" ? (
              <Moon size={16} />
            ) : (
              <Sun size={16} />
            )}
          </button>
        </div>
      </footer>
      {dialog === "from" || dialog === "to" ? (
        <AssetSelector
          title={dialog === "from" ? "You pay" : "You receive"}
          selected={dialog === "from" ? from : to}
          favorites={favorites}
          onFavorite={(s) =>
            setFavorites((prev) =>
              prev.includes(s) ? prev.filter((v) => v !== s) : [...prev, s],
            )
          }
          onClose={closeDialog}
          onSelect={(asset) => {
            if (dialog === "from") setFrom(asset);
            else setTo(asset);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "wallet" && (
        <Modal
          title="Connect a wallet"
          subtitle="Your wallet. Your assets. Always in your control."
          onClose={closeDialog}
        >
          <div className="wallet-options">
            <button onClick={connect} disabled={connecting}>
              <span className="wallet-logo fox">◈</span>
              <div>
                <strong>Browser wallet</strong>
                <small>
                  {window.ethereum
                    ? "Detected · MetaMask, Rabby & more"
                    : "MetaMask, Rabby, Coinbase & more"}
                </small>
              </div>
              {connecting ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <ChevronRight size={18} />
              )}
            </button>
            <button disabled>
              <span className="wallet-logo blue">⌁</span>
              <div>
                <strong>WalletConnect</strong>
                <small>Mobile wallets · integration pending</small>
              </div>
              <span className="pill">Soon</span>
            </button>
            <button disabled>
              <span className="wallet-logo violet">◕</span>
              <div>
                <strong>Phantom</strong>
                <small>Solana signing · integration pending</small>
              </div>
              <span className="pill">Soon</span>
            </button>
          </div>
          {walletError && (
            <p className="form-error" role="alert">
              {walletError}
            </p>
          )}
          <div className="demo-wallet-panel">
            <span className="eyebrow">JUST LOOKING AROUND?</span>
            <h3>Take Hoplane for a test drive.</h3>
            <p>
              Explore with sample balances. No account, real funds, or wallet
              permissions needed.
            </p>
            <button
              className="secondary-button"
              onClick={() => {
                setWallet({
                  address: "0x000000000000000000000000000000000000dEaD",
                  type: "demo",
                  name: "Demo wallet",
                });
                setDialog(null);
                notify(
                  "Demo wallet connected. All balances and transfers are simulated.",
                );
              }}
            >
              Try demo wallet
              <ArrowRight size={16} />
            </button>
          </div>
          <p className="wallet-note">
            <ShieldCheck size={15} />
            We never ask for a seed phrase or private key.
          </p>
        </Modal>
      )}
      {dialog === "settings" && (
        <Modal
          title="Make it your own"
          subtitle="Your preferences are saved on this device."
          onClose={closeDialog}
        >
          <div className="setting-group">
            <label>
              Slippage tolerance
              <Info size={14} />
            </label>
            <p>Maximum price change you’re comfortable with.</p>
            <div className="slippage-options">
              {["auto", "0.5", "1"].map((v) => (
                <button
                  key={v}
                  className={settings.slippage === v ? "selected" : ""}
                  onClick={() => setSettings((s) => ({ ...s, slippage: v }))}
                >
                  {v === "auto" ? "Auto" : `${v}%`}
                </button>
              ))}
              <div>
                <input
                  aria-label="Custom slippage"
                  placeholder="Custom"
                  inputMode="decimal"
                  value={
                    ["auto", "0.5", "1"].includes(settings.slippage)
                      ? ""
                      : settings.slippage
                  }
                  onChange={(e) => {
                    if (
                      /^\d*\.?\d{0,2}$/.test(e.target.value) &&
                      Number(e.target.value) <= 50
                    )
                      setSettings((s) => ({
                        ...s,
                        slippage: e.target.value || "auto",
                      }));
                  }}
                />
                <span>%</span>
              </div>
            </div>
            {Number(settings.slippage) > 5 && (
              <p className="warning-text">
                High slippage can significantly reduce the tokens you receive.
              </p>
            )}
          </div>
          <div className="setting-row">
            <div>
              <strong>Destination gas</strong>
              <p>Request native gas on eligible routes.</p>
            </div>
            <button
              role="switch"
              aria-checked={settings.gasTopup}
              aria-label="Destination gas"
              className={`toggle ${settings.gasTopup ? "on" : ""}`}
              onClick={() =>
                setSettings((s) => ({ ...s, gasTopup: !s.gasTopup }))
              }
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>Testnet preference</strong>
              <p>Use test networks when live integration is ready.</p>
            </div>
            <button
              role="switch"
              aria-checked={settings.testnet}
              aria-label="Testnet preference"
              className={`toggle ${settings.testnet ? "on" : ""}`}
              onClick={() =>
                setSettings((s) => ({ ...s, testnet: !s.testnet }))
              }
            >
              <span />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>Appearance</strong>
              <p>A little light or a little dark.</p>
            </div>
            <div className="theme-options">
              <button
                className={settings.theme === "light" ? "selected" : ""}
                aria-label="Light theme"
                onClick={() => setSettings((s) => ({ ...s, theme: "light" }))}
              >
                <Sun size={17} />
              </button>
              <button
                className={settings.theme === "dark" ? "selected" : ""}
                aria-label="Dark theme"
                onClick={() => setSettings((s) => ({ ...s, theme: "dark" }))}
              >
                <Moon size={17} />
              </button>
            </div>
          </div>
          <div className="info-box">
            <Info size={16} />
            <span>
              Quotes are illustrative in this preview. Slippage, gas top-up, and
              network preferences do not submit transactions.
            </span>
          </div>
          <button className="primary-button" onClick={closeDialog}>
            Save preferences
            <Check size={17} />
          </button>
        </Modal>
      )}
      {dialog === "review" && (
        <Modal
          title="One last look"
          subtitle="Review your simulated swap before you continue."
          onClose={closeDialog}
        >
          <div className="review-assets">
            <div>
              <TokenIcon
                symbol={from.symbol}
                chainId={from.chainId}
                size={44}
              />
              <span>
                <strong>
                  {amount} {from.symbol}
                </strong>
                <small>From {chainFor(from.chainId).name}</small>
              </span>
            </div>
            <ArrowDown size={20} />
            <div>
              <TokenIcon symbol={to.symbol} chainId={to.chainId} size={44} />
              <span>
                <strong>
                  {q.out.toFixed(6)} {to.symbol}
                </strong>
                <small>To {chainFor(to.chainId).name}</small>
              </span>
            </div>
          </div>
          <div className="review-details">
            <div>
              <span>Recipient</span>
              <strong>
                {shortAddress(
                  recipientOpen ? recipient : wallet?.address || "",
                )}
              </strong>
            </div>
            <div>
              <span>Minimum received</span>
              <strong>
                {q.minimum.toFixed(6)} {to.symbol}
              </strong>
            </div>
            <div>
              <span>Estimated fees</span>
              <strong>{money(q.fee)}</strong>
            </div>
            <div>
              <span>Slippage</span>
              <strong>
                {settings.slippage === "auto"
                  ? "Auto · 0.5%"
                  : `${settings.slippage}%`}
              </strong>
            </div>
            <div>
              <span>Estimated time</span>
              <strong>~{q.seconds} seconds</strong>
            </div>
          </div>
          <div className="info-box">
            <Info size={17} />
            <span>
              This is a simulation with sample prices. No blockchain transaction
              is signed or submitted, and no assets move.
            </span>
          </div>
          <button className="primary-button" onClick={startSimulation}>
            Simulate transfer
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {dialog === "progress" && (
        <Modal
          title={
            progress === 3
              ? "A successful practice hop."
              : "Your practice hop is on its way."
          }
          subtitle="Simulation · no real funds have moved"
          onClose={closeDialog}
        >
          <div className={`success-orb ${progress === 3 ? "done" : ""}`}>
            {progress === 3 ? (
              <Check size={38} />
            ) : (
              <ArrowLeftRight size={34} />
            )}
          </div>
          <div className="progress-steps">
            {[
              "Review transaction",
              "Move across networks",
              "Receive your tokens",
            ].map((label, i) => (
              <div
                key={label}
                className={
                  progress > i ? "complete" : progress === i ? "current" : ""
                }
              >
                <span>
                  {progress > i ? (
                    <Check size={15} />
                  ) : progress === i ? (
                    <Loader2 className="spin" size={15} />
                  ) : (
                    i + 1
                  )}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {i === 0
                      ? chainFor(from.chainId).name
                      : i === 1
                        ? "Simulated Relay route"
                        : chainFor(to.chainId).name}
                  </small>
                </div>
                {progress > i && <span className="step-done">Done</span>}
              </div>
            ))}
          </div>
          {progress === 3 && (
            <>
              <div className="simulation-received">
                <span>Simulated receipt</span>
                <strong>
                  {lastActivity?.received} {to.symbol}
                </strong>
              </div>
              <button
                className="primary-button"
                onClick={() => {
                  setDialog(null);
                  navigate("activity");
                }}
              >
                View activity
                <ArrowRight size={16} />
              </button>
            </>
          )}
          <p className="wallet-note">
            Demo records are saved only in this browser.
          </p>
        </Modal>
      )}
      {dialog === "account" && wallet && (
        <Modal
          title={wallet.name}
          subtitle={
            wallet.type === "demo"
              ? "Sample account · no real assets"
              : "Connected for read-only preview"
          }
          onClose={closeDialog}
        >
          <div className="account-avatar">
            <WalletIcon size={32} />
          </div>
          <div className="account-address">
            {shortAddress(wallet.address)}
            <button
              className="icon-button"
              aria-label="Copy wallet address"
              onClick={() => copy(wallet.address)}
            >
              <Copy size={16} />
            </button>
          </div>
          <div className="account-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setDialog(null);
                navigate("portfolio");
              }}
            >
              <WalletIcon size={17} />
              View portfolio
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setWallet(null);
                setDialog(null);
                notify("Wallet disconnected");
              }}
            >
              <LogOut size={17} />
              Disconnect
            </button>
          </div>
          <p className="wallet-note">
            {wallet.type === "demo"
              ? "All demo balances are illustrative."
              : "Balances and cross-device sync require the backend integration."}
          </p>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function AssetSelector({
  title,
  selected,
  favorites,
  onFavorite,
  onSelect,
  onClose,
}: {
  title: string;
  selected: Asset;
  favorites: string[];
  onFavorite: (symbol: string) => void;
  onSelect: (asset: Asset) => void;
  onClose: () => void;
}) {
  const [chainId, setChainId] = useState(selected.chainId),
    [search, setSearch] = useState(""),
    [favoriteOnly, setFavoriteOnly] = useState(false);
  const filtered = tokensForChain(chainId).filter(
    (t) =>
      (!favoriteOnly || favorites.includes(t.symbol)) &&
      `${t.name} ${t.symbol}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Modal
      title={title}
      subtitle="Select a network and a token."
      onClose={onClose}
      wide
    >
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Search tokens"
          autoFocus
          placeholder="Search by token name or symbol"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="icon-button"
            aria-label="Clear search"
            onClick={() => setSearch("")}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="asset-selector-layout">
        <div className="chain-list">
          <span className="eyebrow">NETWORKS</span>
          {CHAINS.map((c) => (
            <button
              className={chainId === c.id ? "selected" : ""}
              key={c.id}
              onClick={() => {
                setChainId(c.id);
                setSearch("");
              }}
            >
              <ChainIcon id={c.id} size={24} />
              <span>{c.name}</span>
              {chainId === c.id && <Check size={15} />}
            </button>
          ))}
        </div>
        <div className="token-list">
          <div className="token-list-title">
            <span>{chainFor(chainId).name}</span>
            <button
              className={
                favoriteOnly ? "favorite-toggle selected" : "favorite-toggle"
              }
              aria-label="Show favorite tokens"
              aria-pressed={favoriteOnly}
              onClick={() => setFavoriteOnly((v) => !v)}
            >
              <Star size={15} />
            </button>
          </div>
          {filtered.map((t) => (
            <div className="token-row" key={t.symbol}>
              <button onClick={() => onSelect({ chainId, symbol: t.symbol })}>
                <TokenIcon symbol={t.symbol} size={35} />
                <span>
                  <strong>{t.symbol}</strong>
                  <small>{t.name}</small>
                </span>
                {selected.chainId === chainId &&
                  selected.symbol === t.symbol && (
                    <Check className="selection-check" size={16} />
                  )}
              </button>
              <button
                className={`icon-button favorite ${favorites.includes(t.symbol) ? "is-favorite" : ""}`}
                aria-label={`${favorites.includes(t.symbol) ? "Unfavorite" : "Favorite"} ${t.symbol}`}
                onClick={() => onFavorite(t.symbol)}
              >
                <Star size={15} />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="selector-empty">
              <Search size={26} />
              <strong>No tokens found</strong>
              <p>Try a different symbol or network.</p>
              <button
                className="text-button"
                onClick={() => {
                  setSearch("");
                  setFavoriteOnly(false);
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>
      <p className="selector-note">
        <Info size={14} />
        Preview token catalog. Live token discovery and contract imports require
        API integration.
      </p>
    </Modal>
  );
}
