import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Info,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { api, BackendError } from "../lib/backend";
import "./vaults.css";

type Pool = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  assetAddress: string;
  decimals: number;
  totalShares: string;
  totalSharesFormatted: string;
  totalAssets: string;
  outstandingDebt: string;
  updatedAt: number;
};
type Catalog = { pools: Pool[]; fetchedAt: number; truncated: boolean };
type Position = {
  chainId: number;
  poolAddress: string;
  shareBalance: string;
  shareBalanceFormatted: string | null;
  symbol: string | null;
  updatedAt: number;
};
type Positions = {
  positions: Position[];
  fetchedAt: number;
  truncated: boolean;
};
const chainName = (id: number) =>
  ({ 1: "Ethereum", 42161: "Arbitrum" })[id] || `Chain ${id}`;
const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
const explorer = (id: number, address: string) =>
  ({ 1: "https://etherscan.io", 42161: "https://arbiscan.io" })[id]
    ? `${{ 1: "https://etherscan.io", 42161: "https://arbiscan.io" }[id]}/address/${address}`
    : null;
const explain = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Vault information is unavailable. Please retry.";
const detailAmount = (value: string) =>
  value.length > 24 ? `${value.slice(0, 24)}…` : value;

export default function VaultsView({
  onSwap,
  onAccount,
}: {
  onSwap: () => void;
  onAccount?: () => void;
}) {
  const [tab, setTab] = useState<"vaults" | "positions">("vaults"),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [positions, setPositions] = useState<Positions | null>(null),
    [wallet, setWallet] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [positionLoading, setPositionLoading] = useState(false),
    [error, setError] = useState(""),
    [positionError, setPositionError] = useState(""),
    [reload, setReload] = useState(0),
    [search, setSearch] = useState(""),
    [chain, setChain] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Catalog>("/vaults", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          if (!Array.isArray(result.pools))
            throw new Error("The vault catalog is incomplete. Please retry.");
          setCatalog(result);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(explain(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (tab !== "positions") return;
    const controller = new AbortController();
    setPositionLoading(true);
    setPositionError("");
    setPositions(null);
    api<{ user: { address: string } | null }>("/auth/session", {
      signal: controller.signal,
    })
      .then(async (session) => {
        if (controller.signal.aborted) return;
        setWallet(session.user?.address ?? null);
        if (session.user) {
          const result = await api<Positions>("/vaults/positions", {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            if (!Array.isArray(result.positions))
              throw new Error(
                "Your position response is incomplete. Please retry.",
              );
            setPositions(result);
          }
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof BackendError && err.status === 401) setWallet(null);
        else setPositionError(explain(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPositionLoading(false);
      });
    return () => controller.abort();
  }, [tab, reload]);
  const pools = (catalog?.pools ?? []).filter(
    (p) =>
      (chain === "all" || String(p.chainId) === chain) &&
      `${p.name} ${p.symbol} ${p.address} ${chainName(p.chainId)}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  return (
    <section className="vaults-page" aria-labelledby="vaults-title">
      <header className="vaults-heading">
        <div>
          <span className="vaults-kicker">
            <Layers size={15} /> VAULTS
          </span>
          <h1 id="vaults-title">Your capital. A clear view.</h1>
          <p>Review Relay vaults and follow your existing positions.</p>
        </div>
        <button className="vaults-secondary" onClick={onSwap}>
          <ArrowLeftRight size={17} />
          Back to swap
        </button>
      </header>
      <div className="vaults-notice" role="note">
        <Info size={21} />
        <div>
          <strong>
            Relay vaults are winding down. New deposits are closed.
          </strong>
          <p>
            Existing holders can review withdrawal instructions. Relay’s
            documentation lists 31 December 2026 as the end of its withdrawal UI
            availability; direct contract withdrawals remain a separate process.
          </p>
          <a
            href="https://docs.relay.link/references/protocol/vaults/overview"
            target="_blank"
            rel="noreferrer"
          >
            Read the official update <ArrowUpRight size={15} />
          </a>
        </div>
      </div>
      <div className="vaults-workspace">
        <div className="vaults-toolbar">
          <div
            className="vaults-tabs"
            role="tablist"
            aria-label="Vault views"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "vaults"
                  : event.key === "End"
                    ? "positions"
                    : tab === "vaults"
                      ? "positions"
                      : "vaults";
              setTab(next);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`#${next}-tab`)
                ?.focus();
            }}
          >
            <button
              role="tab"
              tabIndex={tab === "vaults" ? 0 : -1}
              aria-selected={tab === "vaults"}
              aria-controls="vaults-panel"
              id="vaults-tab"
              onClick={() => setTab("vaults")}
            >
              Top vaults
            </button>
            <button
              role="tab"
              tabIndex={tab === "positions" ? 0 : -1}
              aria-selected={tab === "positions"}
              aria-controls="positions-panel"
              id="positions-tab"
              onClick={() => setTab("positions")}
            >
              Your positions
            </button>
          </div>
          <button
            className="vaults-refresh"
            onClick={() => setReload((v) => v + 1)}
            disabled={loading || positionLoading}
            aria-label="Refresh vault information"
          >
            <RefreshCw
              size={17}
              className={loading || positionLoading ? "vaults-spinning" : ""}
            />
            <span>Refresh</span>
          </button>
        </div>
        {tab === "vaults" ? (
          <div role="tabpanel" id="vaults-panel" aria-labelledby="vaults-tab">
            <div className="vaults-filters">
              <label className="vaults-search">
                <Search size={18} />
                <input
                  aria-label="Search vaults"
                  placeholder="Search vaults or contract address"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="vaults-chain">
                <span>Network</span>
                <select
                  aria-label="Filter vault network"
                  value={chain}
                  onChange={(e) => setChain(e.target.value)}
                >
                  <option value="all">All networks</option>
                  {[
                    ...new Set((catalog?.pools ?? []).map((p) => p.chainId)),
                  ].map((id) => (
                    <option key={id} value={id}>
                      {chainName(id)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {loading ? (
              <div className="vaults-state" role="status">
                <RefreshCw className="vaults-spinning" size={25} />
                <h2>Loading vault information</h2>
                <p>Reading the provider’s indexed vault catalog.</p>
              </div>
            ) : error ? (
              <div className="vaults-state vaults-error" role="alert">
                <Info size={27} />
                <h2>Vault information is unavailable</h2>
                <p>{error}</p>
                <button
                  className="vaults-primary"
                  onClick={() => setReload((v) => v + 1)}
                >
                  Try again
                </button>
                <p className="vaults-small">
                  No balance or yield has been estimated. You can still use the
                  official withdrawal resources below.
                </p>
              </div>
            ) : pools.length === 0 ? (
              <div className="vaults-state">
                <Search size={27} />
                <h2>
                  {search || chain !== "all"
                    ? "No matching vaults"
                    : "No vaults returned"}
                </h2>
                <p>
                  {search || chain !== "all"
                    ? "Try another name or network."
                    : "The provider returned an empty vault catalog."}
                </p>
                {(search || chain !== "all") && (
                  <button
                    className="vaults-secondary"
                    onClick={() => {
                      setSearch("");
                      setChain("all");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="vaults-list">
                {pools.map((pool) => (
                  <article
                    key={`${pool.chainId}:${pool.address}`}
                    className="vaults-row"
                  >
                    <div className="vaults-token" aria-hidden="true">
                      Ξ
                    </div>
                    <div className="vaults-pool-name">
                      <h2>{pool.symbol}</h2>
                      <p>{pool.name}</p>
                      <span>
                        {chainName(pool.chainId)} ·{" "}
                        <code>{short(pool.address)}</code>
                      </span>
                    </div>
                    <div className="vaults-shares">
                      <span>Total vault shares</span>
                      <strong title={pool.totalSharesFormatted}>
                        {detailAmount(pool.totalSharesFormatted)}
                      </strong>
                      <small>Indexed share supply</small>
                    </div>
                    <div className="vaults-row-action">
                      <span className="vaults-closed">
                        <Check size={13} />
                        Withdrawals only
                      </span>
                      {explorer(pool.chainId, pool.address) && (
                        <a
                          href={explorer(pool.chainId, pool.address)!}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View contract <ArrowUpRight size={15} />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {catalog && !error && !loading && (
              <div className="vaults-data-note">
                <ShieldCheck size={15} />
                <span>
                  Provider data · Fetched{" "}
                  {new Date(catalog.fetchedAt).toLocaleString()}
                  {catalog.truncated ? " · Showing the first 50 vaults" : ""}.
                  Share supply is not a withdrawable balance.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            role="tabpanel"
            id="positions-panel"
            aria-labelledby="positions-tab"
          >
            {positionLoading ? (
              <div className="vaults-state" role="status">
                <RefreshCw className="vaults-spinning" size={25} />
                <h2>Checking your positions</h2>
                <p>Loading the account verified by your wallet signature.</p>
              </div>
            ) : positionError ? (
              <div className="vaults-state vaults-error" role="alert">
                <Info size={26} />
                <h2>Positions could not be loaded</h2>
                <p>{positionError}</p>
                <button
                  className="vaults-primary"
                  onClick={() => setReload((v) => v + 1)}
                >
                  Try again
                </button>
              </div>
            ) : !wallet ? (
              <div className="vaults-state">
                <Wallet size={30} />
                <h2>Your positions, in one place</h2>
                <p>
                  Sign in with your wallet to view its indexed vault shares.
                </p>
                {onAccount ? (
                  <button className="vaults-primary" onClick={onAccount}>
                    Open account <ChevronRight size={16} />
                  </button>
                ) : (
                  <a className="vaults-primary" href="#/portfolio">
                    Open account <ChevronRight size={16} />
                  </a>
                )}
              </div>
            ) : positions?.positions.length === 0 ? (
              <div className="vaults-state">
                <Layers size={30} />
                <h2>No indexed positions found</h2>
                <p>
                  No positive share balances were returned for{" "}
                  <strong>{short(wallet)}</strong>. This does not replace a
                  direct on-chain balance check.
                </p>
              </div>
            ) : (
              <>
                <p className="vaults-owner">
                  Signed-in wallet <code>{wallet}</code>
                </p>
                <div className="vaults-list">
                  {positions?.positions.map((p) => (
                    <article
                      className="vaults-row"
                      key={`${p.chainId}:${p.poolAddress}`}
                    >
                      <div className="vaults-token" aria-hidden="true">
                        Ξ
                      </div>
                      <div className="vaults-pool-name">
                        <h2>{p.symbol || "Vault position"}</h2>
                        <p>{chainName(p.chainId)}</p>
                        <code>{short(p.poolAddress)}</code>
                      </div>
                      <div className="vaults-shares">
                        <span>Your indexed shares</span>
                        <strong
                          title={p.shareBalanceFormatted ?? p.shareBalance}
                        >
                          {detailAmount(
                            p.shareBalanceFormatted ?? p.shareBalance,
                          )}
                        </strong>
                        <small>
                          {p.shareBalanceFormatted
                            ? "Vault shares"
                            : "Raw share units"}
                        </small>
                      </div>
                      <a
                        className="vaults-manage"
                        href="https://relay.link/vaults"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Manage on Relay <ArrowUpRight size={16} />
                      </a>
                    </article>
                  ))}
                </div>
                {positions?.truncated && (
                  <p className="vaults-data-note">
                    Showing the first 50 indexed records. Additional positions
                    may exist; check the provider or contract directly.
                  </p>
                )}
                <p className="vaults-data-note">
                  Indexed shares do not guarantee immediately available
                  withdrawal liquidity.
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="vaults-guides">
        <a
          href="https://docs.relay.link/references/protocol/vaults/guides/withdrawing"
          target="_blank"
          rel="noreferrer"
        >
          <div className="vaults-guide-icon">
            <Clock3 size={22} />
          </div>
          <div>
            <h2>Understand withdrawals</h2>
            <p>Review exit steps, asset formats, and available liquidity.</p>
          </div>
          <ArrowUpRight size={19} />
        </a>
        <a href="https://relay.link/vaults" target="_blank" rel="noreferrer">
          <div className="vaults-guide-icon">
            <ExternalLink size={22} />
          </div>
          <div>
            <h2>Open Relay vaults</h2>
            <p>Use the provider’s interface to manage an existing position.</p>
          </div>
          <ArrowUpRight size={19} />
        </a>
      </div>
      <p className="vaults-disclosure">
        Hoplane displays read-only provider data. Vault deposits and withdrawal
        signing are not enabled in Hoplane.
      </p>
    </section>
  );
}
