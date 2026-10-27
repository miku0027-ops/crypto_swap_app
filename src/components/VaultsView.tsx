import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Copy,
  Info,
  Layers,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { api, BackendError, connectWalletSession } from "../lib/backend";
import type { Session } from "../lib/backend";
import { KNOWN_VAULTS } from "../../server/vault-metadata";
import { Modal, TokenIcon } from "./Primitives";
import "./vaults.css";

type Pool = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  assetAddress: string;
  decimals?: number;
  assetSymbol: string | null;
  assetDecimals?: number | null;
  totalShares?: string;
  totalSharesFormatted?: string;
  totalAssets?: string;
  totalAssetsFormatted: string | null;
  outstandingDebt?: string;
  updatedAt: number | null;
  apyPercent: string | null;
  tvlUsd: string | null;
  metricsUpdatedAt: number | null;
  metricsSource: string | null;
  metadataSource: string | null;
  dataStale: boolean;
  priceFetchedAt?: number | null;
  priceSource?: string | null;
};
type Catalog = { pools: Pool[]; fetchedAt: number; truncated: boolean };
type Position = {
  wallet: string;
  indexUpdatedAt?: number | null;
  chainId: number;
  poolAddress: string;
  shareBalance: string;
  shareBalanceFormatted: string | null;
  symbol: string | null;
  updatedAt: number;
  dataStale: boolean;
};
type Positions = {
  positions: Position[];
  fetchedAt: number;
  truncated: boolean;
};
const OVERVIEW = "https://docs.relay.link/references/protocol/vaults/overview";
const WITHDRAWALS =
  "https://docs.relay.link/references/protocol/vaults/guides/withdrawing";
const SOURCE = "https://vaults-api.relay.link/";
const chainName = (id: number) =>
  ({ 1: "Ethereum", 42161: "Arbitrum" })[id] || `Chain ${id}`;
const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
const explorer = (id: number, address: string) => {
  const base = { 1: "https://etherscan.io", 42161: "https://arbiscan.io" }[id];
  return base ? `${base}/address/${address}` : null;
};
const explain = (error: unknown) =>
  error instanceof BackendError && error.code === "INVALID_RESPONSE"
    ? "The live vault service is unavailable. Please try again."
    : error instanceof Error
      ? error.message
      : "This information is unavailable. Please retry.";
const time = (value: number | null | undefined) =>
  value && Number.isFinite(value)
    ? new Date(value).toLocaleString()
    : "Unavailable";
const decimal = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value);
// Never round monetary strings through Number: ordering must retain every digit.
function compareDecimal(left: string, right: string) {
  const [li, lf = ""] = left.split("."),
    [ri, rf = ""] = right.split(".");
  const scale = Math.max(lf.length, rf.length);
  const a = BigInt(li + lf.padEnd(scale, "0")),
    b = BigInt(ri + rf.padEnd(scale, "0"));
  return a < b ? -1 : a > b ? 1 : 0;
}
function formatDecimal(value: string, fraction = 6) {
  const [integer, digits = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const clipped = digits.slice(0, fraction).replace(/0+$/, "");
  return `${grouped}${clipped ? `.${clipped}` : ""}${/[1-9]/.test(digits.slice(fraction)) ? "…" : ""}`;
}
const referencePools: Pool[] = KNOWN_VAULTS.map((pool) => ({
  ...pool,
  totalAssetsFormatted: null,
  updatedAt: null,
  apyPercent: null,
  tvlUsd: null,
  metricsUpdatedAt: null,
  metricsSource: null,
  dataStale: false,
}));
function Metric({
  value,
  suffix = "",
  prefix = "",
  label,
}: {
  value: string | null | undefined;
  suffix?: string;
  prefix?: string;
  label: string;
}) {
  return decimal(value) ? (
    <strong className="vaults-metric" title={`${prefix}${value}${suffix}`}>
      {prefix}
      {formatDecimal(value, prefix ? 2 : 4)}
      {suffix}
    </strong>
  ) : (
    <span
      className="vaults-unavailable"
      title={`${label} is not available from a verified data source.`}
      aria-label={`${label} unavailable`}
    >
      —
    </span>
  );
}

export default function VaultsView({
  onSwap,
}: {
  onSwap: () => void;
  onAccount?: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [positions, setPositions] = useState<Positions | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [positionLoading, setPositionLoading] = useState(true),
    [connecting, setConnecting] = useState(false),
    [error, setError] = useState(""),
    [positionError, setPositionError] = useState(""),
    [walletNotice, setWalletNotice] = useState(""),
    [reload, setReload] = useState(0),
    [positionReload, setPositionReload] = useState(0),
    [search, setSearch] = useState(""),
    [chain, setChain] = useState("all"),
    [sort, setSort] = useState<{
      field: "apyPercent" | "tvlUsd";
      direction: "ascending" | "descending";
    }>({ field: "tvlUsd", direction: "descending" }),
    [noticeVisible, setNoticeVisible] = useState(true),
    [selected, setSelected] = useState<Pool | null>(null),
    [copyState, setCopyState] = useState("");
  const generation = useRef(0),
    positionController = useRef<AbortController | null>(null),
    connectController = useRef<AbortController | null>(null),
    connectingRef = useRef(false),
    requiresSignIn = useRef(false),
    sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const clearIdentity = useCallback((message: string) => {
    generation.current += 1;
    positionController.current?.abort();
    requiresSignIn.current = true;
    sessionRef.current = null;
    setSession(null);
    setPositions(null);
    setPositionError("");
    setPositionLoading(false);
    setWalletNotice(message);
  }, []);
  const confirmProvider = useCallback(
    async (verified: Session, controller: AbortController, id: number) => {
      if (!window.ethereum) return true;
      let accounts: unknown;
      try {
        accounts = await window.ethereum.request({ method: "eth_accounts" });
      } catch {
        /* Verification is unavailable; never display a different account's positions. */
      }
      if (controller.signal.aborted || id !== generation.current) return false;
      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== "string" ||
        accounts[0].toLowerCase() !== verified.user.address.toLowerCase()
      ) {
        clearIdentity(
          "Your wallet is disconnected or changed. Connect again to view the correct positions.",
        );
        return false;
      }
      return true;
    },
    [clearIdentity],
  );
  const readPositions = useCallback(
    async (verified: Session, controller: AbortController, id: number) => {
      const result = await api<Positions>("/vaults/positions", {
        signal: controller.signal,
      });
      if (controller.signal.aborted || id !== generation.current) return;
      if (verified.expiresAt <= Date.now()) {
        clearIdentity(
          "Your session expired. Connect your wallet again to refresh your positions.",
        );
        return;
      }
      if (!Array.isArray(result.positions))
        throw new Error("Your position response is incomplete. Please retry.");
      if (
        result.positions.some(
          (position) =>
            typeof position.wallet !== "string" ||
            position.wallet.toLowerCase() !==
              verified.user.address.toLowerCase(),
        )
      )
        throw new Error(
          "Your wallet session changed. Connect again to view the correct positions.",
        );
      if (!(await confirmProvider(verified, controller, id))) return;
      if (controller.signal.aborted || id !== generation.current) return;
      setPositions(result);
    },
    [clearIdentity, confirmProvider],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelected(null);
    api<Catalog>("/vaults", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.pools))
          throw new Error("The vault catalog is incomplete. Please retry.");
        setCatalog(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setCatalog(null);
          setError(explain(err));
          setSelected(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    if (requiresSignIn.current) return;
    const controller = new AbortController(),
      id = ++generation.current;
    positionController.current = controller;
    setPositionLoading(true);
    setPositionError("");
    setPositions(null);
    setSession(null);
    api<Session | { user: null }>("/auth/session", {
      signal: controller.signal,
    })
      .then(async (verified) => {
        if (controller.signal.aborted || id !== generation.current) return;
        if (!verified.user) {
          setSession(null);
          return;
        }
        if (
          !/^0x[0-9a-f]{40}$/i.test(verified.user.address) ||
          /^0x0{40}$/i.test(verified.user.address) ||
          !/^[0-9a-f]{64}$/i.test(verified.csrfToken) ||
          !Number.isSafeInteger(verified.expiresAt)
        )
          throw new Error(
            "Your wallet session could not be verified. Please connect again.",
          );
        if (verified.expiresAt <= Date.now()) {
          clearIdentity(
            "Your session expired. Connect your wallet again to refresh your positions.",
          );
          return;
        }
        if (!(await confirmProvider(verified, controller, id))) return;
        setSession(verified);
        sessionRef.current = verified;
        await readPositions(verified, controller, id);
      })
      .catch((err) => {
        if (controller.signal.aborted || id !== generation.current) return;
        setPositions(null);
        if (err instanceof BackendError && err.status === 401)
          clearIdentity("Connect your wallet to view your positions.");
        else setPositionError(explain(err));
      })
      .finally(() => {
        if (!controller.signal.aborted && id === generation.current)
          setPositionLoading(false);
      });
    return () => controller.abort();
  }, [positionReload, clearIdentity, readPositions, confirmProvider]);
  useEffect(() => {
    const provider = window.ethereum;
    const changed = () =>
      clearIdentity(
        "Your wallet changed. Connect again to view this account’s positions.",
      );
    const recheckSession = () => {
      if (
        document.visibilityState === "hidden" ||
        requiresSignIn.current ||
        !sessionRef.current ||
        connectingRef.current
      )
        return;
      generation.current += 1;
      positionController.current?.abort();
      setPositions(null);
      setSession(null);
      setPositionLoading(true);
      setPositionReload((value) => value + 1);
    };
    provider?.on?.("accountsChanged", changed);
    window.addEventListener("focus", recheckSession);
    document.addEventListener("visibilitychange", recheckSession);
    return () => {
      window.removeEventListener("focus", recheckSession);
      document.removeEventListener("visibilitychange", recheckSession);
      provider?.removeListener?.("accountsChanged", changed);
      connectController.current?.abort();
      generation.current += 1;
    };
  }, [clearIdentity]);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = session.expiresAt - Date.now();
      if (remaining <= 0)
        clearIdentity(
          "Your session expired. Connect your wallet again to refresh your positions.",
        );
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [session, clearIdentity]);
  const connect = async () => {
    if (connectingRef.current) return;
    if (!window.ethereum) {
      setWalletNotice(
        "Open Hoplane in your wallet browser, or install a browser wallet to connect.",
      );
      return;
    }
    const controller = new AbortController();
    connectController.current = controller;
    positionController.current?.abort();
    generation.current += 1;
    connectingRef.current = true;
    setConnecting(true);
    setPositionLoading(false);
    setSession(null);
    setPositions(null);
    setPositionError("");
    setWalletNotice("");
    try {
      const verified = await connectWalletSession(window.ethereum, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      requiresSignIn.current = false;
      const id = ++generation.current;
      positionController.current = controller;
      setSession(verified);
      sessionRef.current = verified;
      setWalletNotice("");
      setPositionLoading(true);
      await readPositions(verified, controller, id);
    } catch (err) {
      if (!controller.signal.aborted) {
        setPositions(null);
        setPositionError(explain(err));
      }
    } finally {
      connectingRef.current = false;
      setConnecting(false);
      if (!controller.signal.aborted) setPositionLoading(false);
    }
  };
  const refreshPositions = () => {
    if (requiresSignIn.current) {
      void connect();
      return;
    }
    setPositionReload((value) => value + 1);
  };
  const closeDetails = useCallback(() => {
    setSelected(null);
    setCopyState("");
  }, []);
  const allPools = catalog?.pools ?? (error ? referencePools : []);
  const pools = allPools
    .filter(
      (pool) =>
        (chain === "all" || String(pool.chainId) === chain) &&
        `${pool.name} ${pool.symbol} ${pool.assetSymbol ?? ""} ${pool.address} ${chainName(pool.chainId)}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((left, right) => {
      const a = left[sort.field],
        b = right[sort.field];
      if (!decimal(a)) return decimal(b) ? 1 : 0;
      if (!decimal(b)) return -1;
      return compareDecimal(a, b) * (sort.direction === "ascending" ? 1 : -1);
    });
  const toggleSort = (field: "apyPercent" | "tvlUsd") =>
    setSort((prior) => ({
      field,
      direction:
        prior.field === field && prior.direction === "descending"
          ? "ascending"
          : "descending",
    }));
  const sortIcon = (field: "apyPercent" | "tvlUsd") =>
    sort.field !== field ? (
      <ArrowUpDown size={14} />
    ) : sort.direction === "ascending" ? (
      <ArrowUp size={14} />
    ) : (
      <ArrowDown size={14} />
    );
  const owner = session?.user.address;
  return (
    <section className="vaults-page" aria-labelledby="vaults-title">
      <header className="vaults-heading">
        <div>
          <span className="vaults-kicker">
            <Layers size={15} /> YOUR ONCHAIN OVERVIEW
          </span>
          <h1 id="vaults-title">Vaults</h1>
          <p>Your positions and the vaults behind them. All in view.</p>
        </div>
        <button className="vaults-secondary" onClick={onSwap}>
          <ArrowLeftRight size={17} /> Back to swap
        </button>
      </header>
      <div className="vaults-lifecycle">
        <span className="vaults-closed">
          <LockKeyhole size={13} /> Withdrawals only
        </span>
        <a href={OVERVIEW} target="_blank" rel="noreferrer">
          Vault lifecycle <ArrowUpRight size={14} />
        </a>
        {!noticeVisible && (
          <button onClick={() => setNoticeVisible(true)}>
            View retirement details
          </button>
        )}
      </div>
      <section className="vaults-section" aria-labelledby="positions-title">
        <div className="vaults-section-heading">
          <div>
            <h2 id="positions-title">Your Positions</h2>
            <p>Private to your verified wallet session.</p>
          </div>
          {owner && (
            <button
              className="vaults-refresh"
              onClick={refreshPositions}
              disabled={positionLoading}
              aria-label="Refresh your positions"
            >
              <RefreshCw
                size={16}
                className={positionLoading ? "vaults-spinning" : ""}
              />
              <span>Refresh</span>
            </button>
          )}
        </div>
        <div className="vaults-positions-card" aria-busy={positionLoading}>
          {positionLoading ? (
            <div className="vaults-state" role="status">
              <RefreshCw className="vaults-spinning" size={25} />
              <h3>Checking your positions</h3>
              <p>Reading your verified session and indexed vault shares.</p>
            </div>
          ) : positionError ? (
            <div className="vaults-state vaults-error" role="alert">
              <Info size={27} />
              <h3>Positions are unavailable</h3>
              <p>{positionError}</p>
              <div className="vaults-state-actions">
                <button className="vaults-secondary" onClick={refreshPositions}>
                  Retry positions
                </button>
                {!owner && (
                  <button
                    className="vaults-primary"
                    onClick={() => void connect()}
                    disabled={connecting}
                  >
                    {connecting ? "Connecting…" : "Connect Wallet"}
                  </button>
                )}
              </div>
              <p className="vaults-small">
                Your balance has not been estimated.
              </p>
            </div>
          ) : !owner ? (
            <div className="vaults-state vaults-connect">
              <span className="vaults-wallet-art">
                <Wallet size={30} />
                <span>
                  <ShieldCheck size={14} />
                </span>
              </span>
              <h3>A clear view of your positions</h3>
              <p>
                Connect your wallet to see your indexed vault shares and
                withdrawal resources.
              </p>
              <button
                className="vaults-primary"
                onClick={() => void connect()}
                disabled={connecting}
              >
                {connecting ? (
                  <RefreshCw size={17} className="vaults-spinning" />
                ) : (
                  <Wallet size={17} />
                )}
                {connecting ? "Connecting…" : "Connect Wallet"}
                <ChevronRight size={17} />
              </button>
              <span className="vaults-wallet-note">
                <ShieldCheck size={13} /> A sign-in signature. No fund transfer.
              </span>
              {walletNotice && (
                <p role="status" className="vaults-wallet-notice">
                  {walletNotice}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="vaults-owner">
                <span>
                  <span className="vaults-status-dot" /> Verified wallet
                </span>
                <code title={owner}>{short(owner)}</code>
                <button
                  onClick={() =>
                    clearIdentity(
                      "Wallet view disconnected. Connect again to refresh your positions.",
                    )
                  }
                  className="vaults-disconnect"
                >
                  Disconnect view
                </button>
              </div>
              {positions?.positions.length === 0 ? (
                <div className="vaults-state">
                  <Layers size={28} />
                  <h3>No indexed positions found</h3>
                  <p>
                    No positive vault shares were returned for this wallet.
                    Confirm recent activity with the provider or a block
                    explorer.
                  </p>
                </div>
              ) : (
                <div className="vaults-position-list">
                  {positions?.positions.map((position) => (
                    <article
                      key={`${position.chainId}:${position.poolAddress}`}
                      className="vaults-position"
                    >
                      <div className="vaults-position-identity">
                        <TokenIcon
                          symbol="ETH"
                          chainId={position.chainId}
                          size={40}
                        />
                        <div>
                          <h3>{position.symbol || "Vault position"}</h3>
                          <p>
                            {chainName(position.chainId)} ·{" "}
                            <code>{short(position.poolAddress)}</code>
                          </p>
                          <p className="vaults-position-activity">
                            Last indexed activity: {time(position.updatedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="vaults-shares">
                        <span>Your indexed shares</span>
                        <strong
                          title={
                            position.shareBalanceFormatted ??
                            position.shareBalance
                          }
                        >
                          {formatDecimal(
                            position.shareBalanceFormatted ??
                              position.shareBalance,
                          )}
                        </strong>
                        <small>
                          {position.shareBalanceFormatted === null
                            ? "Raw share units"
                            : "Vault shares"}
                        </small>
                        {position.indexUpdatedAt == null && (
                          <span className="vaults-freshness-unknown">
                            Index freshness unavailable
                          </span>
                        )}
                        {position.dataStale && (
                          <span className="vaults-stale">
                            <Clock3 size={12} /> Index data over 1h old
                          </span>
                        )}
                      </div>
                      <a
                        className="vaults-secondary"
                        href="https://relay.link/vaults"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Manage on Relay <ArrowUpRight size={15} />
                      </a>
                    </article>
                  ))}
                </div>
              )}
              {positions && (
                <p className="vaults-data-note">
                  <Info size={14} />
                  <span>
                    Relay index · Fetched {time(positions.fetchedAt)}. Shares
                    are not a guaranteed withdrawable balance.
                    {positions.truncated &&
                      " Showing the first 50 records; more positions may exist."}
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      </section>
      <section className="vaults-section" aria-labelledby="top-vaults-title">
        <div className="vaults-section-heading">
          <div>
            <h2 id="top-vaults-title">Top Vaults</h2>
            <p>Explore assets, networks, and reported vault metrics.</p>
          </div>
          <button
            className="vaults-refresh"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
            aria-label="Refresh vault information"
          >
            <RefreshCw size={16} className={loading ? "vaults-spinning" : ""} />
            <span>Refresh</span>
          </button>
        </div>
        <div className="vaults-workspace" aria-busy={loading}>
          <div className="vaults-filters">
            <label className="vaults-search">
              <Search size={18} />
              <input
                aria-label="Search vaults"
                placeholder="Search assets or contracts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  aria-label="Clear vault search"
                  onClick={() => setSearch("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <label className="vaults-chain">
              <span>Network</span>
              <select
                aria-label="Filter vaults by network"
                value={chain}
                onChange={(event) => setChain(event.target.value)}
              >
                <option value="all">All networks</option>
                {[...new Set(allPools.map((pool) => pool.chainId))].map(
                  (id) => (
                    <option key={id} value={id}>
                      {chainName(id)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          {error && (
            <div className="vaults-service-note" role="status">
              <Info size={18} />
              <div>
                <strong>Reference vaults · live data unavailable</strong>
                <p>
                  {error} Contract details remain available; no live metrics are
                  shown.
                </p>
              </div>
              <button
                onClick={() => setReload((value) => value + 1)}
                className="vaults-text-button"
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="vaults-state" role="status">
              <RefreshCw className="vaults-spinning" size={25} />
              <h3>Loading vault information</h3>
              <p>Reading the provider’s indexed catalog.</p>
            </div>
          ) : pools.length === 0 ? (
            <div className="vaults-state">
              <Search size={27} />
              <h3>
                {search || chain !== "all"
                  ? "No matching vaults"
                  : "No vaults returned"}
              </h3>
              <p>
                {search || chain !== "all"
                  ? "Try another asset, address, or network."
                  : "The provider returned an empty catalog."}
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
            <>
              <p className="vaults-scroll-hint">
                <ArrowLeftRight size={13} /> Scroll horizontally to view all
                metrics
              </p>
              <div
                className="vaults-table-scroll"
                role="region"
                aria-label="Vault metrics table"
                tabIndex={0}
              >
                <table className="vaults-table">
                  <thead>
                    <tr>
                      <th scope="col">Vault</th>
                      <th
                        scope="col"
                        aria-sort={
                          sort.field === "apyPercent" ? sort.direction : "none"
                        }
                      >
                        <button
                          aria-label="Sort by APY"
                          onClick={() => toggleSort("apyPercent")}
                        >
                          APY {sortIcon("apyPercent")}
                        </button>
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sort.field === "tvlUsd" ? sort.direction : "none"
                        }
                      >
                        <button
                          aria-label="Sort by TVL"
                          onClick={() => toggleSort("tvlUsd")}
                        >
                          TVL {sortIcon("tvlUsd")}
                        </button>
                      </th>
                      <th scope="col">
                        <span className="vaults-sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pools.map((pool) => (
                      <tr key={`${pool.chainId}:${pool.address}`}>
                        <th scope="row">
                          <button
                            className="vaults-asset-button"
                            aria-label={`View ${pool.assetSymbol || pool.symbol} vault on ${chainName(pool.chainId)}`}
                            onClick={() => {
                              setSelected(pool);
                              setCopyState("");
                            }}
                          >
                            <TokenIcon
                              symbol={
                                pool.assetSymbol === "WETH"
                                  ? "ETH"
                                  : pool.assetSymbol || "?"
                              }
                              chainId={pool.chainId}
                              size={42}
                            />
                            <span>
                              <strong>{pool.assetSymbol || pool.symbol}</strong>
                              <span>{chainName(pool.chainId)}</span>
                              <small>{short(pool.address)}</small>
                            </span>
                          </button>
                        </th>
                        <td>
                          <Metric
                            value={pool.apyPercent}
                            suffix="%"
                            label="APY"
                          />
                          <span className="vaults-metric-caption">
                            {decimal(pool.apyPercent)
                              ? "Reported APY"
                              : "Not available"}
                          </span>
                          {pool.dataStale && (
                            <span
                              className="vaults-stale"
                              title="The provider’s index timestamp is more than one hour old."
                            >
                              <Clock3 size={11} /> Older index data
                            </span>
                          )}
                        </td>
                        <td>
                          <Metric value={pool.tvlUsd} prefix="$" label="TVL" />
                          <span
                            className="vaults-metric-caption"
                            title={
                              pool.totalAssetsFormatted && pool.assetSymbol
                                ? `${pool.totalAssetsFormatted} ${pool.assetSymbol}`
                                : undefined
                            }
                          >
                            {decimal(pool.totalAssetsFormatted) &&
                            pool.assetSymbol
                              ? `${formatDecimal(pool.totalAssetsFormatted, 4)} ${pool.assetSymbol}`
                              : "Asset amount unavailable"}
                          </span>
                          {!decimal(pool.tvlUsd) &&
                            decimal(pool.totalAssetsFormatted) && (
                              <small className="vaults-metric-footnote">
                                USD value unavailable
                              </small>
                            )}
                        </td>
                        <td>
                          <button
                            className="vaults-row-arrow"
                            aria-label={`Open details for ${pool.name} on ${chainName(pool.chainId)}`}
                            onClick={() => {
                              setSelected(pool);
                              setCopyState("");
                            }}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!loading && (
            <p className="vaults-data-note">
              <ShieldCheck size={14} />
              <span>
                {catalog
                  ? `Relay index · Fetched ${time(catalog.fetchedAt)}${catalog.truncated ? " · First 50 vaults" : ""}.`
                  : "Documented contract metadata only."}{" "}
                APY is historical, not a guaranteed return. Indexed assets
                include outstanding debt and may not be immediately
                withdrawable.
              </span>
            </p>
          )}
        </div>
      </section>
      {noticeVisible && (
        <aside className="vaults-notice" aria-label="Vault retirement notice">
          <Info size={20} />
          <div>
            <strong>Relay vaults are being retired</strong>
            <p>
              New deposits are closed. Relay’s withdrawal interface is scheduled
              to close on <b>31 December 2026</b>; direct contract withdrawals
              remain available afterward.
            </p>
            <a href={WITHDRAWALS} target="_blank" rel="noreferrer">
              Withdrawal instructions <ArrowUpRight size={14} />
            </a>
          </div>
          <button
            className="vaults-notice-close"
            aria-label="Dismiss retirement notice"
            onClick={() => setNoticeVisible(false)}
          >
            <X size={18} />
          </button>
        </aside>
      )}
      <p className="vaults-disclosure">
        <ShieldCheck size={14} /> Read-only in Hoplane. Review and manage
        withdrawals through the official provider.
      </p>
      {selected && (
        <Modal
          title="Vault details"
          subtitle={`${selected.assetSymbol || selected.symbol} · ${chainName(selected.chainId)}`}
          onClose={closeDetails}
        >
          <div className="vaults-detail">
            <span className="vaults-closed">
              <LockKeyhole size={13} /> Withdrawals only
            </span>
            <h3>{selected.name}</h3>
            <p>
              Underlying asset:{" "}
              <strong>{selected.assetSymbol || "Unavailable"}</strong>. Vault
              shares: <strong>{selected.symbol}</strong>.
            </p>
            <div className="vaults-contract">
              <span>Vault contract · {chainName(selected.chainId)}</span>
              <code>{selected.address}</code>
              <div>
                <button
                  className="vaults-secondary"
                  aria-label="Copy vault contract"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(selected.address);
                      setCopyState("Contract address copied");
                    } catch {
                      setCopyState(
                        "Copy unavailable. Select the contract address above to copy it.",
                      );
                    }
                  }}
                >
                  <Copy size={14} /> Copy address
                </button>
                {explorer(selected.chainId, selected.address) && (
                  <a
                    className="vaults-secondary"
                    href={explorer(selected.chainId, selected.address)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View contract <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
              {copyState && <p role="status">{copyState}</p>}
            </div>
            <dl className="vaults-detail-metrics">
              <div>
                <dt>Reported APY</dt>
                <dd>
                  <Metric value={selected.apyPercent} suffix="%" label="APY" />
                </dd>
              </div>
              <div>
                <dt>Total indexed assets</dt>
                <dd>
                  {decimal(selected.totalAssetsFormatted) ? (
                    <span title={selected.totalAssetsFormatted}>
                      {formatDecimal(selected.totalAssetsFormatted, 18)}{" "}
                      {selected.assetSymbol}
                    </span>
                  ) : (
                    "Unavailable"
                  )}
                </dd>
              </div>
              <div>
                <dt>USD value</dt>
                <dd>
                  <Metric value={selected.tvlUsd} prefix="$" label="TVL" />
                </dd>
              </div>
              <div>
                <dt>Last index update</dt>
                <dd>
                  {time(selected.updatedAt)}
                  {selected.dataStale && (
                    <span className="vaults-stale">Index data over 1h old</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Metrics timestamp</dt>
                <dd>{time(selected.metricsUpdatedAt)}</dd>
              </div>
              <div>
                <dt>Price timestamp</dt>
                <dd>{time(selected.priceFetchedAt)}</dd>
              </div>
              <div>
                <dt>Price source</dt>
                <dd>
                  {selected.priceSource?.startsWith(
                    "https://api.relay.link/currencies/token/price?",
                  ) ? (
                    <a
                      href={selected.priceSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Relay currency prices <ArrowUpRight size={13} />
                    </a>
                  ) : (
                    selected.priceSource || "Unavailable"
                  )}
                </dd>
              </div>
              <div>
                <dt>Last fetched</dt>
                <dd>
                  {catalog ? time(catalog.fetchedAt) : "Live data unavailable"}
                </dd>
              </div>
              <div>
                <dt>Data source</dt>
                <dd>
                  {catalog ? (
                    <a href={SOURCE} target="_blank" rel="noreferrer">
                      Relay vault index <ArrowUpRight size={13} />
                    </a>
                  ) : (
                    "Reference contract metadata"
                  )}
                </dd>
              </div>
            </dl>
            <p className="vaults-detail-note">
              <Info size={15} /> APY is not guaranteed. Indexed assets include
              outstanding debt; these amounts do not establish how much can be
              withdrawn now.
            </p>
            <a
              className="vaults-primary"
              href={WITHDRAWALS}
              target="_blank"
              rel="noreferrer"
            >
              Review withdrawal instructions <ArrowUpRight size={16} />
            </a>
            <a
              className="vaults-detail-source"
              href={
                selected.metadataSource?.startsWith("https://docs.relay.link/")
                  ? selected.metadataSource
                  : OVERVIEW
              }
              target="_blank"
              rel="noreferrer"
            >
              Official vault documentation <ArrowUpRight size={13} />
            </a>
          </div>
        </Modal>
      )}
    </section>
  );
}
