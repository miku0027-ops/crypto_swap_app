import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Info,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { api, apiBase } from "../lib/backend";
import { CHAINS } from "../lib/data";
import { publicFeedSchema } from "../../server/transactions-contract";
import type {
  PublicFeed,
  PublicLeg,
  PublicTransaction,
} from "../../server/transactions-contract";
import { Modal } from "./Primitives";
import "./transactions.css";

const chainName = (id: number) =>
  CHAINS.find((chain) => chain.id === id)?.name ??
  (
    {
      4663: "Robinhood Chain",
      196: "X Layer",
      999: "HyperEVM",
      143: "Monad",
      57073: "Ink",
      480: "World Chain",
      747474: "Katana",
      728126428: "Tron",
    } as Record<number, string>
  )[id] ??
  `Chain ${id}`;
const short = (v: string) =>
  v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v;
const exactAmount = (v: string) => {
  const [whole, fraction = ""] = v.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction.slice(0, 6)}` : ""}${fraction.length > 6 ? "…" : ""}`;
};
const when = (v: number) => new Date(v).toLocaleString();
const age = (value: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - value) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : `${Math.floor(seconds / 3600)}h ago`;
};
export function transactionExplorer(
  chainId: number,
  value: string,
  address = false,
): string | null {
  const base: Record<number, string> = {
    1: "https://etherscan.io",
    8453: "https://basescan.org",
    42161: "https://arbiscan.io",
    10: "https://optimistic.etherscan.io",
    56: "https://bscscan.com",
    137: "https://polygonscan.com",
    43114: "https://snowtrace.io",
    7777777: "https://explorer.zora.energy",
    534352: "https://scrollscan.com",
    59144: "https://lineascan.build",
    81457: "https://blastscan.io",
    324: "https://explorer.zksync.io",
    999: "https://hyperevmscan.io",
    196: "https://xlayerscan.com",
    143: "https://monadvision.com",
    4663: "https://robin.etherscan.io",
    480: "https://worldscan.org",
    57073: "https://explorer.inkonchain.com",
    747474: "https://explorer.katanarpc.com",
  };
  if (chainId === 792703809 && /^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(value))
    return `https://solscan.io/${address ? "account" : "tx"}/${value}`;
  if (
    !base[chainId] ||
    !(address ? /^0x[\da-fA-F]{40}$/ : /^0x[\da-fA-F]{64}$/).test(value)
  )
    return null;
  return `${base[chainId]}/${address ? "address" : "tx"}/${value}`;
}
const statuses: Record<
  PublicTransaction["status"],
  { label: string; tone: string }
> = {
  success: { label: "Completed", tone: "success" },
  refund: { label: "Refunded", tone: "refund" },
  failure: { label: "Failed", tone: "failure" },
  waiting: { label: "Waiting", tone: "pending" },
  depositing: { label: "Depositing", tone: "pending" },
  pending: { label: "In progress", tone: "pending" },
  submitted: { label: "Submitted", tone: "pending" },
  unknown: { label: "Unknown", tone: "unknown" },
};
function Status({ value }: { value: PublicTransaction["status"] }) {
  const s = statuses[value];
  return (
    <span className={`tx-status tx-status-${s.tone}`}>
      {value === "success" ? (
        <CheckCircle2 size={13} />
      ) : value === "failure" ? (
        <XCircle size={13} />
      ) : (
        <Clock3 size={13} />
      )}
      {s.label}
    </span>
  );
}
function Asset({ leg }: { leg: PublicLeg | null }) {
  if (!leg)
    return (
      <div className="tx-asset-unavailable">Asset details unavailable</div>
    );
  const chain = CHAINS.find((c) => c.id === leg.chainId);
  return (
    <div className="tx-asset">
      <span
        className={`tx-token tx-token-${["ETH", "WETH", "USDC", "USDT", "SOL", "BNB"].includes(leg.symbol) ? leg.symbol.toLowerCase() : "other"}`}
        aria-hidden="true"
      >
        {leg.symbol === "USDC"
          ? "$"
          : leg.symbol === "ETH" || leg.symbol === "WETH"
            ? "Ξ"
            : leg.symbol.slice(0, 2)}
        <span
          className="tx-chain-badge"
          style={{ background: chain?.color ?? "var(--green)" }}
        >
          {chain?.symbol ?? "#"}
        </span>
      </span>
      <span>
        <strong title={`${leg.amountFormatted} ${leg.symbol}`}>
          {exactAmount(leg.amountFormatted)} <b>{leg.symbol}</b>
        </strong>
        <small>
          {chainName(leg.chainId)}
          {leg.amountKind === "quoted" && " · Quoted"}
        </small>
      </span>
    </div>
  );
}

export default function TransactionsView({
  personal,
  initialScope = "network",
  personalLabel = "Your history",
}: {
  personal: ReactNode;
  initialScope?: "network" | "personal";
  personalLabel?: string;
}) {
  const [scope, setScope] = useState(initialScope),
    [feed, setFeed] = useState<PublicFeed | null>(null),
    [connection, setConnection] = useState("connecting"),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(false),
    [reload, setReload] = useState(0),
    [online, setOnline] = useState(navigator.onLine),
    [visible, setVisible] = useState(document.visibilityState !== "hidden"),
    [now, setNow] = useState(Date.now()),
    [search, setSearch] = useState(""),
    [fromChain, setFromChain] = useState("all"),
    [toChain, setToChain] = useState("all"),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<PublicTransaction | null>(null),
    [copied, setCopied] = useState("");
  useEffect(() => {
    setScope(initialScope);
  }, [initialScope]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    const connectivity = () => setOnline(navigator.onLine),
      visibility = () => setVisible(document.visibilityState !== "hidden");
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const accept = useCallback((value: unknown) => {
    const parsed = publicFeedSchema.safeParse(value);
    if (!parsed.success || parsed.data.fetchedAt > Date.now() + 300_000)
      throw new Error(
        "The activity feed could not be verified. Reconnecting shortly.",
      );
    setFeed((previous) =>
      previous && previous.fetchedAt > parsed.data.fetchedAt
        ? previous
        : parsed.data,
    );
    setError("");
    setConnection("connected");
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (scope !== "network" || paused || !online || !visible) return;
    const controller = new AbortController();
    let source: EventSource | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false,
      failures = 0,
      refreshMs = 60_000;
    setConnection("connecting");
    const failed = (message: string) => {
      if (!stopped) {
        setConnection("reconnecting");
        setError(message);
      }
    };
    const poll = async () => {
      try {
        const snapshot = await api<unknown>("/transactions", {
          signal: controller.signal,
        });
        if (stopped) return;
        accept(snapshot);
        failures = 0;
        const parsed = publicFeedSchema.parse(snapshot);
        refreshMs = parsed.nextRefreshMs;
        timer = setTimeout(poll, refreshMs);
      } catch (err) {
        if (stopped) return;
        failed(
          err instanceof Error ? err.message : "Live activity is unavailable.",
        );
        timer = setTimeout(
          poll,
          Math.min(300_000, 60_000 * 2 ** Math.min(failures++, 2)),
        );
      }
    };
    const boot = async () => {
      // One initial snapshot makes first paint independent of stream buffering.
      try {
        const snapshot = await api<unknown>("/transactions", {
          signal: controller.signal,
        });
        if (!stopped) {
          accept(snapshot);
          refreshMs = publicFeedSchema.parse(snapshot).nextRefreshMs;
        }
      } catch (err) {
        if (!stopped)
          failed(
            err instanceof Error
              ? err.message
              : "Live activity is unavailable.",
          );
      }
      if (stopped) return;
      if (typeof EventSource === "undefined") {
        timer = setTimeout(poll, refreshMs);
        return;
      }
      source = new EventSource(`${apiBase()}/transactions/stream`, {
        withCredentials: true,
      });
      source.addEventListener("snapshot", (event) => {
        if (stopped) return;
        try {
          accept(JSON.parse((event as MessageEvent).data));
        } catch {
          failed(
            "The activity feed could not be verified. Reconnecting shortly.",
          );
        }
      });
      source.addEventListener("feed-error", (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          failed(
            typeof data.message === "string"
              ? data.message
              : "Activity updates are delayed.",
          );
        } catch {
          failed("Activity updates are delayed.");
        }
      });
      source.onerror = () => {
        if (stopped) return;
        source?.close();
        failed(
          "The live connection was interrupted. Refreshing automatically.",
        );
        timer = setTimeout(poll, refreshMs);
      };
    };
    void boot();
    return () => {
      stopped = true;
      controller.abort();
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [scope, paused, online, visible, reload, accept]);
  const rows = useMemo(
    () =>
      (feed?.transactions ?? []).filter((row) => {
        const q = search.trim().toLowerCase();
        return (
          (fromChain === "all" || String(row.from?.chainId) === fromChain) &&
          (toChain === "all" || String(row.to?.chainId) === toChain) &&
          (status === "all" ||
            (status === "pending"
              ? ["pending", "waiting", "depositing", "submitted"].includes(
                  row.status,
                )
              : row.status === status)) &&
          (!q ||
            [
              row.id,
              row.sender,
              row.recipient,
              row.from?.symbol,
              row.to?.symbol,
              ...row.depositTxs.map((tx) => tx.hash),
              ...row.fillTxs.map((tx) => tx.hash),
            ].some((value) => value?.toLowerCase().includes(q)))
        );
      }),
    [feed, search, fromChain, toChain, status],
  );
  const networks = [
    ...new Set(
      (feed?.transactions ?? [])
        .flatMap((row) => [row.from?.chainId, row.to?.chainId])
        .filter((v): v is number => typeof v === "number"),
    ),
  ].sort((a, b) => chainName(a).localeCompare(chainName(b)));
  const old = !!feed && now - feed.fetchedAt > feed.nextRefreshMs * 2 + 15_000;
  const state = !online
    ? "Offline"
    : paused
      ? "Paused"
      : !visible
        ? "Paused in background"
        : old || error
          ? "Updates delayed"
          : connection === "connected"
            ? "Live activity"
            : "Connecting";
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("Copied to clipboard");
    } catch {
      setCopied(`Copy unavailable. Select and copy: ${value}`);
    }
  };
  const addressLine = (
    label: string,
    value: string | null,
    chainId?: number,
  ) => (
    <div className="tx-address">
      <span>{label}:</span>
      {value ? (
        <>
          {chainId && transactionExplorer(chainId, value, true) ? (
            <a
              href={transactionExplorer(chainId, value, true)!}
              target="_blank"
              rel="noreferrer"
              title={value}
            >
              {short(value)}
            </a>
          ) : (
            <code title={value}>{short(value)}</code>
          )}
          <button
            aria-label={`Copy ${label.toLowerCase()} ${value}`}
            onClick={() => void copy(value)}
          >
            <Copy size={14} />
          </button>
        </>
      ) : (
        <small>Unavailable</small>
      )}
    </div>
  );
  const txLink = (
    tx: PublicTransaction["depositTxs"][number],
    label: string,
  ) => {
    const link = transactionExplorer(tx.chainId, tx.hash);
    return link ? (
      <a
        key={`${tx.chainId}:${tx.hash}`}
        href={link}
        target="_blank"
        rel="noreferrer"
        title={`${tx.hash} · ${chainName(tx.chainId)}`}
      >
        {label} <ArrowUpRight size={13} />
      </a>
    ) : (
      <span key={`${tx.chainId}:${tx.hash}`} title={tx.hash}>
        {label} · {short(tx.hash)}
      </span>
    );
  };
  const clear = () => {
    setSearch("");
    setFromChain("all");
    setToChain("all");
    setStatus("all");
  };
  return (
    <section className="transactions-page" aria-labelledby="transactions-title">
      <header className="tx-heading">
        <div>
          <span className="tx-eyebrow">
            <Activity size={14} /> EVERY MOVE, IN VIEW
          </span>
          <h1 id="transactions-title">Transactions</h1>
          <p>Follow public swaps and bridges across the Relay network.</p>
        </div>
        <a
          className="tx-source-link"
          href="https://relay.link/transactions"
          target="_blank"
          rel="noreferrer"
        >
          View source <ArrowUpRight size={15} />
        </a>
      </header>
      <div
        className="tx-tabs"
        role="tablist"
        aria-label="Transaction activity"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "network"
              : event.key === "End"
                ? "personal"
                : scope === "network"
                  ? "personal"
                  : "network";
          setScope(next);
          event.currentTarget
            .querySelector<HTMLButtonElement>(`#${next}-transactions-tab`)
            ?.focus();
        }}
      >
        <button
          role="tab"
          tabIndex={scope === "network" ? 0 : -1}
          aria-selected={scope === "network"}
          aria-controls="network-transactions"
          id="network-transactions-tab"
          onClick={() => setScope("network")}
        >
          <GlobeMark /> Network activity
        </button>
        <button
          role="tab"
          tabIndex={scope === "personal" ? 0 : -1}
          aria-selected={scope === "personal"}
          aria-controls="personal-transactions"
          id="personal-transactions-tab"
          onClick={() => setScope("personal")}
        >
          {personalLabel}
        </button>
      </div>
      {scope === "personal" ? (
        <div
          id="personal-transactions"
          role="tabpanel"
          aria-labelledby="personal-transactions-tab"
          className="tx-personal"
        >
          {personal}
        </div>
      ) : (
        <div
          id="network-transactions"
          role="tabpanel"
          aria-labelledby="network-transactions-tab"
        >
          <div className="tx-source-bar">
            <span
              className={`tx-live-badge ${state !== "Live activity" ? "tx-live-muted" : ""}`}
            >
              <i />
              {state}
            </span>
            <span>
              Relay network <span className="tx-source-divider">/</span> Public
              activity
            </span>
            <div className="tx-live-actions">
              <button
                aria-label={
                  paused ? "Resume live updates" : "Pause live updates"
                }
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? <Play size={15} /> : <Pause size={15} />}
                <span>{paused ? "Resume" : "Pause"}</span>
              </button>
              <button
                aria-label="Refresh public transactions"
                disabled={!online}
                onClick={() => {
                  setPaused(false);
                  setReload((v) => v + 1);
                }}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>
          <div className="tx-search">
            <Search size={20} />
            <input
              aria-label="Search loaded public transactions"
              placeholder="Search wallet, transaction hash, or token"
              maxLength={256}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                aria-label="Clear transaction search"
                onClick={() => setSearch("")}
              >
                <X size={17} />
              </button>
            )}
          </div>
          <div className="tx-filters">
            <label>
              From
              <select
                aria-label="From network"
                value={fromChain}
                onChange={(e) => setFromChain(e.target.value)}
              >
                <option value="all">All networks</option>
                {networks.map((id) => (
                  <option key={id} value={id}>
                    {chainName(id)}
                  </option>
                ))}
              </select>
            </label>
            <ArrowLeftRight size={15} aria-hidden="true" />
            <label>
              To
              <select
                aria-label="To network"
                value={toChain}
                onChange={(e) => setToChain(e.target.value)}
              >
                <option value="all">All networks</option>
                {networks.map((id) => (
                  <option key={id} value={id}>
                    {chainName(id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                aria-label="Transaction status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="success">Completed</option>
                <option value="pending">In progress</option>
                <option value="failure">Failed</option>
                <option value="refund">Refunded</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            {(search ||
              fromChain !== "all" ||
              toChain !== "all" ||
              status !== "all") && (
              <button className="tx-clear" onClick={clear}>
                Clear filters
              </button>
            )}
          </div>
          {(error || !online || old || feed?.providerDataOld) && (
            <div className="tx-notice" role="status">
              {!online ? <WifiOff size={17} /> : <Info size={17} />}
              <span>
                {!online
                  ? "You are offline. Showing the last received snapshot."
                  : feed?.providerDataOld
                    ? "The provider’s latest indexed activity is over five minutes old."
                    : error ||
                      "No fresh snapshot has arrived. Reconnecting automatically."}
                {feed && " Last received data stays visible below."}
              </span>
            </div>
          )}
          <p className="tx-table-meta">
            <span>
              {feed
                ? `${rows.length} of ${feed.transactions.length} latest indexed requests`
                : "Connecting to the public activity feed"}
            </span>
            <span>
              {feed
                ? `Updated ${age(feed.fetchedAt, now)} · ${feed.nextRefreshMs / 1000}s refresh`
                : "No wallet connection needed"}
            </span>
          </p>
          <div className="tx-table-card">
            {!feed ? (
              <div className="tx-empty" role="status">
                {error ? (
                  <WifiOff size={30} />
                ) : (
                  <Loader2 size={30} className="tx-spinning" />
                )}
                <h2>
                  {error
                    ? "Live activity is unavailable"
                    : "Loading real network activity"}
                </h2>
                <p>
                  {error ||
                    "Reading the provider’s latest indexed swaps and bridges."}
                </p>
                {error && (
                  <button onClick={() => setReload((v) => v + 1)}>
                    Retry connection
                  </button>
                )}
              </div>
            ) : !rows.length ? (
              <div className="tx-empty">
                <Search size={29} />
                <h2>
                  {feed.transactions.length
                    ? "No matching transactions"
                    : "No public transactions returned"}
                </h2>
                <p>
                  {feed.transactions.length
                    ? "Search applies to the latest loaded records. Try another wallet, hash, token, or network."
                    : "The feed returned no indexed records. Updates will continue automatically."}
                </p>
                {feed.transactions.length > 0 && (
                  <button onClick={clear}>Clear filters</button>
                )}
              </div>
            ) : (
              <>
                <p className="tx-scroll-hint">
                  <ArrowLeftRight size={13} /> Scroll to see transactions,
                  status, and fill time
                </p>
                <div
                  className="tx-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Public transactions table"
                >
                  <table className="tx-table">
                    <thead>
                      <tr>
                        <th scope="col">From</th>
                        <th scope="col">To</th>
                        <th scope="col">Transactions</th>
                        <th scope="col">Status</th>
                        <th scope="col">Fill time</th>
                        <th scope="col">
                          <span className="tx-sr-only">Details</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <Asset leg={row.from} />
                            {addressLine(
                              "Sender",
                              row.sender,
                              row.from?.chainId,
                            )}
                          </td>
                          <td>
                            <Asset leg={row.to} />
                            {addressLine(
                              "Recipient",
                              row.recipient,
                              row.to?.chainId,
                            )}
                          </td>
                          <td>
                            <div className="tx-hashes">
                              {row.depositTxs[0] &&
                                txLink(row.depositTxs[0], "Deposit")}
                              {row.fillTxs[0] &&
                                txLink(
                                  row.fillTxs[0],
                                  row.status === "refund" ? "Refund" : "Fill",
                                )}
                              <small title={when(row.createdAt)}>
                                {age(row.createdAt, now)}
                              </small>
                            </div>
                          </td>
                          <td>
                            <Status value={row.status} />
                          </td>
                          <td>
                            <span
                              className="tx-fill-time"
                              title="Calculated from provider-reported deposit and fill timestamps"
                            >
                              {row.fillTimeSeconds === null
                                ? "—"
                                : `${row.fillTimeSeconds}s`}
                            </span>
                          </td>
                          <td>
                            <button
                              className="tx-detail-button"
                              aria-label={`Details for transaction ${row.id}`}
                              onClick={() => setSelected(row)}
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
          </div>
          <div className="tx-trust-note">
            <Info size={15} />
            <p>
              Public Relay network activity includes swaps from other apps.
              Statuses and amounts are provider-reported; quoted amounts are
              labelled. Follow explorer links to inspect each transaction.
              Search covers the latest loaded records.
              {feed?.omittedCount
                ? ` ${feed.omittedCount} incomplete or unbroadcast records were omitted.`
                : ""}
            </p>
          </div>
          {copied && (
            <p className="tx-copy-feedback" role="status">
              <Check size={14} />
              {copied}
            </p>
          )}
        </div>
      )}
      {selected && (
        <Modal
          title="Transaction details"
          subtitle="Relay network · provider-reported activity"
          onClose={() => setSelected(null)}
        >
          <div className="tx-details">
            <Status value={selected.status} />
            <dl>
              <div>
                <dt>Request ID</dt>
                <dd>
                  <code>{selected.id}</code>
                  <button
                    aria-label="Copy request ID"
                    onClick={() => void copy(selected.id)}
                  >
                    <Copy size={14} />
                  </button>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{when(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>Last provider update</dt>
                <dd>{when(selected.updatedAt)}</dd>
              </div>
              <div>
                <dt>Fill time</dt>
                <dd>
                  {selected.fillTimeSeconds === null
                    ? "Unavailable"
                    : `${selected.fillTimeSeconds} seconds`}
                </dd>
              </div>
            </dl>
            <div className="tx-details-route">
              <Asset leg={selected.from} />
              <ArrowLeftRight size={18} />
              <Asset leg={selected.to} />
            </div>
            {addressLine("Sender", selected.sender, selected.from?.chainId)}
            {addressLine("Recipient", selected.recipient, selected.to?.chainId)}
            {([selected.from, selected.to] as const).map(
              (leg, i) =>
                leg && (
                  <p className="tx-exact-amount" key={i}>
                    {i ? "Destination" : "Source"}:{" "}
                    <strong>
                      {leg.amountFormatted} {leg.symbol}
                    </strong>{" "}
                    ·{" "}
                    {leg.amountKind === "quoted"
                      ? "Quoted amount"
                      : "Reported amount"}
                    <br />
                    Asset identifier: <code>{leg.address}</code>
                  </p>
                ),
            )}
            <div className="tx-detail-links">
              {selected.depositTxs.map((tx, i) =>
                txLink(tx, `Deposit ${i + 1} · ${chainName(tx.chainId)}`),
              )}
              {selected.fillTxs.map((tx, i) =>
                txLink(
                  tx,
                  `${selected.status === "refund" ? "Refund" : "Fill"} ${i + 1} · ${chainName(tx.chainId)}`,
                ),
              )}
            </div>
            <p className="tx-detail-caption">
              Fill time uses indexed transaction timestamps, rather than time
              spent in the interface. This record is a snapshot; chain explorers
              provide independent transaction evidence.
            </p>
            {copied && <p role="status">{copied}</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}
function GlobeMark() {
  return (
    <span className="tx-network-mark" aria-hidden="true">
      ◉
    </span>
  );
}
