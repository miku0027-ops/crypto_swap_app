import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  Code2,
  ExternalLink,
  Globe2,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { api, type Session } from "../lib/backend";
import {
  RELAY_DOCS,
  RELAY_REFERENCE_CHECKED_AT,
  type RelayDocCategory,
} from "../lib/relay-reference";
import "./resources.css";

type Destination =
  | "swap"
  | "documentation"
  | "api-reference"
  | "product-api"
  | "product-protocol"
  | "testnets"
  | "withdraw"
  | "app-balance";
type Props = {
  page: string;
  onNavigate: (page: Destination) => void;
  onAccount: () => void;
};
type Guide = {
  eyebrow: string;
  title: string;
  description: string;
  availability: string;
  items: [string, string][];
  url: string;
  link: string;
  categories: RelayDocCategory[];
};
const guides: Record<string, Guide> = {
  "solutions-wallets": {
    eyebrow: "SOLUTIONS / WALLETS",
    title: "One wallet. More possibilities.",
    description:
      "Connect a wallet, choose the networks, review a route, and follow the transfer in one place.",
    availability:
      "Hoplane supports injected EVM wallets. Mobile wallet connections and smart-account execution require additional integration.",
    items: [
      [
        "Wallet ownership",
        "Sign a time-limited message to access your preferences and transaction history.",
      ],
      [
        "Clear transaction review",
        "Check the recipient, amounts, minimum received, expiry, and transaction details before signing.",
      ],
      [
        "Recovery across devices",
        "Sign in with the same address and recover an existing transaction by its hash.",
      ],
    ],
    url: "https://relay.link/wallets-solution",
    link: "Explore Relay’s wallet solution",
    categories: ["Solutions", "Features"],
  },
  "solutions-apps": {
    eyebrow: "SOLUTIONS / MULTICHAIN APPS",
    title: "Bring the route into your app.",
    description:
      "Cross-chain actions connect a source asset to an action on another network. The integration determines which actions are available.",
    availability:
      "Hoplane currently supports reviewed deposit routes. Arbitrary destination calls and multistep execution are not enabled.",
    items: [
      [
        "Source and destination",
        "Select assets by their chain and contract address, with verified metadata.",
      ],
      [
        "Quote before execution",
        "The backend validates amounts, slippage, ownership, and supported transaction formats.",
      ],
      [
        "Follow the result",
        "Source submission and destination settlement are separate stages in transaction history.",
      ],
    ],
    url: "https://docs.relay.link/solutions/multichain-apps",
    link: "Read the multichain guide",
    categories: ["Solutions", "Features"],
  },
  "solutions-chains": {
    eyebrow: "SOLUTIONS / CHAINS",
    title: "A deliberate path between networks.",
    description:
      "Available routes depend on provider support, liquidity, and the networks enabled by the application.",
    availability:
      "Hoplane’s chain selector uses the provider catalog intersected with its configured EVM networks. A listed chain does not guarantee every route.",
    items: [
      [
        "Network discovery",
        "Current metadata identifies supported chains and native assets.",
      ],
      [
        "Explicit environments",
        "Testnet and mainnet remain distinct; mainnet transfers are disabled in the default deployment.",
      ],
      [
        "Transaction verification",
        "Configured RPC endpoints check submitted transaction details against the reviewed route.",
      ],
    ],
    url: "https://docs.relay.link/solutions/chains",
    link: "Read the chain integration guide",
    categories: ["Solutions", "Platform"],
  },
  "solutions-payments": {
    eyebrow: "SOLUTIONS / COMMERCE & PAYMENTS",
    title: "Design around the payment.",
    description:
      "Funding, checkout, and fee sponsorship are separate capabilities. Each needs its own integration and transaction policy.",
    availability:
      "Payment checkout, fiat ramps, and fee sponsorship are not enabled in Hoplane. The reference library explains the provider capabilities.",
    items: [
      [
        "Funding flows",
        "Let users choose a supported source asset and destination when an integration is enabled.",
      ],
      [
        "Fee sponsorship",
        "Integrator deposits can fund eligible fees through the provider’s app balance.",
      ],
      [
        "Clear boundaries",
        "A swap quote does not authorize a merchant payment or a recurring charge.",
      ],
    ],
    url: "https://docs.relay.link/solutions/commerce-and-payments",
    link: "Read the payments guide",
    categories: ["Solutions", "Features"],
  },
  "product-dashboard": {
    eyebrow: "PRODUCTS / DASHBOARD",
    title: "Your integration, at a glance.",
    description:
      "Relay’s dashboard manages provider applications, API credentials, and integration analytics.",
    availability:
      "This is a Relay-managed service. Hoplane does not expose your provider keys in the browser or impersonate the provider dashboard.",
    items: [
      [
        "Provider applications",
        "Manage your application in the official provider dashboard.",
      ],
      [
        "Server-side keys",
        "Configure API credentials through your backend’s secret manager.",
      ],
      [
        "Account balances",
        "View earned fees and sponsorship balances separately from wallet assets.",
      ],
    ],
    url: "https://dashboard.relay.link/",
    link: "Open Relay Dashboard",
    categories: ["Platform", "Features"],
  },
  "product-app": {
    eyebrow: "PRODUCTS / APP",
    title: "The Hoplane workspace.",
    description:
      "A focused place to choose assets, review a transfer, and follow what happens next.",
    availability:
      "Live routes reflect backend availability. Demo mode remains an explicit simulation with sample balances and no fund movement.",
    items: [
      [
        "Swap and bridge",
        "Select a source and destination, adjust slippage, and review a fresh quote.",
      ],
      [
        "Transactions",
        "See your signed-in account’s transfer records and recovery options.",
      ],
      [
        "Saved preferences",
        "Keep supported account preferences and favorites associated with your wallet address.",
      ],
    ],
    url: "https://relay.link/bridge",
    link: "View the Relay app reference",
    categories: ["Platform", "Resources"],
  },
  "product-api": {
    eyebrow: "PRODUCTS / API",
    title: "A validated API between app and provider.",
    description:
      "Hoplane’s backend owns authentication and validation. Relay supplies route quotes and cross-chain settlement.",
    availability:
      "Quote access needs a server-side Relay app key. Public metadata is available without enabling wallet execution.",
    items: [
      ["Discover", "Fetch enabled networks and verified currencies."],
      [
        "Review",
        "Request a quote with exact base-unit amounts and a supported recipient.",
      ],
      [
        "Track",
        "Record an RPC-verified source hash and follow the provider’s settlement status.",
      ],
    ],
    url: "https://docs.relay.link/references/api/overview",
    link: "Open Relay API documentation",
    categories: ["API"],
  },
  "product-protocol": {
    eyebrow: "PRODUCTS / PROTOCOL",
    title: "Understand the settlement path.",
    description:
      "Deposits, fills, verification, and withdrawal are different steps in Relay’s cross-chain protocol.",
    availability:
      "Hoplane uses Relay for settlement. It does not operate its own bridge contracts, solver network, or independent destination verification.",
    items: [
      [
        "Deposit",
        "A user-authorized transaction funds the route on its source network.",
      ],
      [
        "Fill and settlement",
        "Provider infrastructure coordinates the corresponding destination transfer.",
      ],
      [
        "Recovery",
        "Unsettled deposits may require the separate Relay Hub recovery flow.",
      ],
    ],
    url: "https://docs.relay.link/references/protocol/overview",
    link: "Read the protocol documentation",
    categories: ["Protocol", "Security"],
  },
  "product-kit": {
    eyebrow: "PRODUCTS / RELAYKIT",
    title: "Tools for building a cross-chain interface.",
    description:
      "RelayKit provides provider-maintained SDKs and interface components for supported integrations.",
    availability:
      "Hoplane currently uses its own UI and backend adapter. RelayKit is available here as a developer reference, not an installed capability.",
    items: [
      [
        "SDK integration",
        "Read the setup and client guides before choosing a package.",
      ],
      [
        "Interface components",
        "Review widget, theme, event, and wallet configuration references.",
      ],
      [
        "Execution policy",
        "A UI package does not replace validation, user review, or application-specific safeguards.",
      ],
    ],
    url: "https://docs.relay.link/references/relay-kit/overview",
    link: "Explore RelayKit",
    categories: ["RelayKit"],
  },
};
const usefulDocs = (categories: RelayDocCategory[]) =>
  RELAY_DOCS.filter((d) => categories.includes(d.category)).slice(0, 6);
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
function ReferenceLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a className="resource-link" href={href} {...external}>
      {children}
      <ArrowUpRight size={17} />
    </a>
  );
}
function Intro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header className="resource-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}
function Documents({ apiOnly = false }: { apiOnly?: boolean }) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("All");
  const source = apiOnly
    ? RELAY_DOCS.filter((d) => d.category === "API")
    : RELAY_DOCS;
  const categories = [...new Set(source.map((d) => d.category))];
  const docs = useMemo(
    () =>
      source.filter(
        (d) =>
          (category === "All" || d.category === category) &&
          `${d.title} ${d.summary} ${d.category}`
            .toLowerCase()
            .includes(search.toLowerCase().trim()),
      ),
    [search, category, apiOnly],
  );
  return (
    <>
      <Intro
        eyebrow="DEVELOPERS / REFERENCE LIBRARY"
        title={apiOnly ? "API reference" : "Documentation"}
      >
        Find every page in Relay’s public documentation index, organized by
        topic. Articles open on the official documentation site.
      </Intro>
      <div className="resource-library-toolbar">
        <label className="resource-search">
          <Search size={19} />
          <input
            aria-label="Search documentation"
            placeholder="Search guides, endpoints, features…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="resource-category">
          Topic
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Documentation topic"
          >
            <option>All</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="resource-result-count" aria-live="polite">
        <strong>{docs.length}</strong>{" "}
        {docs.length === 1 ? "reference" : "references"}
        <span>Index reviewed {RELAY_REFERENCE_CHECKED_AT}</span>
      </div>
      {apiOnly && (
        <section className="resource-local-api">
          <div>
            <Code2 size={23} />
            <h2>Hoplane’s own API</h2>
            <p>
              Wallet sessions, quote policy, tracking, and account data live
              behind our backend.
            </p>
          </div>
          <ReferenceLink href="https://github.com/miku0027-ops/crypto_swap_app/blob/main/docs/BACKEND.md">
            Read our API contract
          </ReferenceLink>
        </section>
      )}
      <div className="resource-document-grid">
        {docs.map((d) => (
          <a
            key={d.id}
            href={d.url}
            {...external}
            className="resource-document"
          >
            <span>
              {d.category}
              <ArrowUpRight size={15} />
            </span>
            <h2>{d.title}</h2>
            <p>{d.summary}</p>
          </a>
        ))}
      </div>
      {!docs.length && (
        <div className="resource-empty">
          <Search size={27} />
          <h2>No matching references</h2>
          <p>Try a different term or select all topics.</p>
          <button
            onClick={() => {
              setSearch("");
              setCategory("All");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
function ServiceStatus() {
  const [state, setState] = useState<"loading" | "available" | "unavailable">(
      "loading",
    ),
    [config, setConfig] = useState<{
      capabilities: Record<string, boolean>;
    } | null>(null),
    [reload, setReload] = useState(0),
    [checked, setChecked] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setState("loading");
    Promise.all([
      api("/health", { signal: c.signal }),
      api<{ capabilities: Record<string, boolean> }>("/config", {
        signal: c.signal,
      }),
    ])
      .then(([, v]) => {
        setConfig(v);
        setState("available");
        setChecked(new Date().toLocaleTimeString());
      })
      .catch(() => {
        if (!c.signal.aborted) {
          setState("unavailable");
          setChecked(new Date().toLocaleTimeString());
        }
      });
    return () => c.abort();
  }, [reload]);
  return (
    <>
      <Intro
        eyebrow="DEVELOPERS / SERVICE STATUS"
        title="Know what’s available."
      >
        Current application availability and the official provider status page,
        kept separate.
      </Intro>
      <section className="resource-status-card">
        <div className={`resource-status-mark ${state}`} aria-hidden="true">
          {state === "loading" ? (
            <Loader2 className="spin" />
          ) : state === "available" ? (
            <Check />
          ) : (
            <CircleHelp />
          )}
        </div>
        <div>
          <h2>Hoplane API</h2>
          <p role="status">
            {state === "loading"
              ? "Checking the connection…"
              : state === "available"
                ? "Responding to the current availability check."
                : "The backend could not be reached from this preview."}
          </p>
          {checked && (
            <small>Checked {checked} · this is a point-in-time check</small>
          )}
        </div>
        <button
          className="resource-outline-button"
          disabled={state === "loading"}
          onClick={() => setReload((n) => n + 1)}
        >
          Check again
        </button>
      </section>
      {state === "available" && config && (
        <div className="resource-service-grid">
          {[
            ["quotes", "Quotes"],
            ["execution", "Transaction execution"],
            ["balances", "Wallet balances"],
            ["sync", "Account sync"],
          ].map(([key, label]) => (
            <div key={key}>
              <strong>{label}</strong>
              <span
                className={
                  config.capabilities[key]
                    ? "resource-badge enabled"
                    : "resource-badge"
                }
              >
                {config.capabilities[key] ? "Configured" : "Not enabled"}
              </span>
            </div>
          ))}
        </div>
      )}
      <section className="resource-panel">
        <h2>Relay provider status</h2>
        <p>
          Provider availability is reported by Relay. A successful Hoplane check
          does not confirm all upstream services are healthy.
        </p>
        <ReferenceLink href="https://status.relay.link/">
          Open official API status
        </ReferenceLink>
      </section>
    </>
  );
}
function Testnets({ onNavigate }: Pick<Props, "onNavigate">) {
  return (
    <>
      <Intro
        eyebrow="DEVELOPERS / TESTNETS"
        title="Practice the real workflow."
      >
        Test networks use test tokens. Check route availability before
        requesting a quote.
      </Intro>
      <div className="resource-card-grid">
        {[
          ["Ethereum Sepolia", "11155111", "https://sepolia.etherscan.io/"],
          ["Base Sepolia", "84532", "https://sepolia-explorer.base.org/"],
        ].map(([name, id, url]) => (
          <section className="resource-panel" key={id}>
            <span className="resource-badge">Default candidate network</span>
            <h2>{name}</h2>
            <p>
              Chain ID <code>{id}</code>
            </p>
            <ReferenceLink href={url}>Open explorer</ReferenceLink>
          </section>
        ))}
      </div>
      <div className="resource-notice">
        <ShieldCheck size={21} />
        <p>
          The backend decides which networks and routes are available. Testnet
          liquidity, quote access, RPC verification, and approved transaction
          targets are still required. Demo mode does not send testnet
          transactions.
        </p>
      </div>
      <div className="resource-actions">
        <button
          className="resource-primary-button"
          onClick={() => onNavigate("swap")}
        >
          Go to swap
          <ArrowRight size={18} />
        </button>
        <ReferenceLink href="https://testnets.relay.link/">
          Open Relay testnets
        </ReferenceLink>
      </div>
      <ReferenceLink href="https://docs.relay.link/references/api/api_guides/testnet">
        Testnet integration guide
      </ReferenceLink>
    </>
  );
}
function Explorer() {
  const [value, setValue] = useState(""),
    [chain, setChain] = useState("1");
  const networks = [
    { id: "1", name: "Ethereum", url: "https://etherscan.io" },
    { id: "8453", name: "Base", url: "https://basescan.org" },
    { id: "42161", name: "Arbitrum", url: "https://arbiscan.io" },
  ];
  const v = value.trim(),
    kind = /^0x[0-9a-fA-F]{64}$/.test(v)
      ? "tx"
      : /^0x[0-9a-fA-F]{40}$/.test(v)
        ? "address"
        : null;
  return (
    <>
      <Intro
        eyebrow="DEVELOPERS / EXPLORERS"
        title="Follow the on-chain record."
      >
        Use the Relay Chain Explorer for protocol activity, or inspect a
        transaction on its own network.
      </Intro>
      <section className="resource-panel resource-explorer">
        <Globe2 size={30} />
        <h2>Relay Chain Explorer</h2>
        <p>
          The official explorer is operated by Relay and opens in a separate
          tab.
        </p>
        <ReferenceLink href="https://explorer.chain.relay.link/">
          Open Relay Chain Explorer
        </ReferenceLink>
      </section>
      <section className="resource-panel">
        <h2>Look up an EVM transaction or address</h2>
        <div className="resource-lookup">
          <label>
            Network
            <select
              aria-label="Explorer network"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
            >
              {networks.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="resource-grow">
            Transaction hash or address
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0x…"
              aria-invalid={!!value && !kind}
              aria-describedby="explorer-input-help"
            />
          </label>
        </div>
        <p
          id="explorer-input-help"
          className={value && !kind ? "resource-error" : "resource-help"}
        >
          {value && !kind
            ? "Enter a complete EVM address or 66-character transaction hash."
            : "Choose the network on which the transaction was submitted."}
        </p>
        {kind && (
          <ReferenceLink
            href={`${networks.find((n) => n.id === chain)!.url}/${kind}/${v}`}
          >
            View on {networks.find((n) => n.id === chain)!.name}
          </ReferenceLink>
        )}
      </section>
    </>
  );
}

type AssetBalance = {
  amount: string;
  amountFormatted: string | null;
  amountUsd: string | null;
  currency: {
    chainId: number;
    address: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
  } | null;
  hubTokenId?: string;
};
type AccountData = {
  balances: AssetBalance[];
  fetchedAt: number;
  hasMore?: boolean;
  totalBalanceUsd?: number | null;
  availableBalanceUsd?: number | null;
  outstandingFastFillBalanceUsd?: number | null;
};
function AccountResource({
  recovery,
  onAccount,
}: {
  recovery: boolean;
  onAccount: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null),
    [data, setData] = useState<AccountData | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [chain, setChain] = useState("1"),
    [tab, setTab] = useState<"balances" | "guide">("balances");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    setSession(null);
    (async () => {
      try {
        const s = await api<Session | { user: null }>("/auth/session", {
          signal: c.signal,
        });
        if (!s.user) {
          setLoading(false);
          return;
        }
        setSession(s as Session);
        const result = await api<AccountData>(
          recovery
            ? `/account/recovery-balances?ownerChainId=${chain}`
            : "/account/app-balance",
          { signal: c.signal },
        );
        setData(result);
      } catch (e) {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Account data is unavailable.",
          );
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [recovery, reload, chain]);
  const official = recovery
    ? "https://relay.link/withdraw"
    : "https://relay.link/app-balance";
  return (
    <>
      <Intro
        eyebrow="APP RESOURCES"
        title={recovery ? "Withdraw funds" : "App balance"}
      >
        {recovery
          ? "Check recovery balances and continue deposit verification or withdrawal through the official Relay Hub flow."
          : "Integrator earnings and fee-sponsorship funds, separate from the assets held in your wallet."}
      </Intro>
      <div className="resource-account-scope">
        <span className="resource-badge">Relay mainnet balances</span>
        <span className="resource-badge">Read-only</span>
      </div>
      <div className="resource-notice">
        <ShieldCheck size={21} />
        <p>
          {recovery
            ? "These balances do not prove withdrawal eligibility or completion. Hoplane reads account data; verification and withdrawal are completed on Relay with your wallet."
            : "This is the provider’s integrator balance. Hoplane does not configure app fees or sponsorship for you, and this page does not deposit or claim funds."}
        </p>
      </div>
      <div
        className="resource-segments"
        role="group"
        aria-label={recovery ? "Withdrawal sections" : "App balance sections"}
      >
        <button
          aria-pressed={tab === "balances"}
          onClick={() => setTab("balances")}
        >
          Balances
        </button>
        <button aria-pressed={tab === "guide"} onClick={() => setTab("guide")}>
          {recovery ? "Verify & withdraw" : "How it works"}
        </button>
      </div>
      {tab === "balances" ? (
        <section className="resource-panel">
          <div className="resource-panel-heading">
            <div>
              <h2>{recovery ? "Recovery balances" : "Your app funds"}</h2>
              {session && (
                <p className="resource-address">{session.user.address}</p>
              )}
            </div>
            <button
              className="resource-outline-button"
              disabled={loading}
              onClick={() => setReload((n) => n + 1)}
            >
              Refresh
            </button>
          </div>
          {recovery && (
            <label className="resource-owner-chain">
              Owner account network
              <select
                aria-label="Recovery owner network"
                value={chain}
                onChange={(e) => setChain(e.target.value)}
              >
                <option value="1">Ethereum · 1</option>
                <option value="8453">Base · 8453</option>
                <option value="42161">Arbitrum · 42161</option>
                <option value="10">Optimism · 10</option>
                <option value="137">Polygon · 137</option>
              </select>
              <span>
                This identifies the owner account in Relay Hub; it is not
                necessarily the deposit network.
              </span>
            </label>
          )}
          {!recovery && data && (
            <div className="resource-balance-totals">
              {(
                [
                  ["Total app balance", data.totalBalanceUsd],
                  ["Available balance", data.availableBalanceUsd],
                  ["Outstanding fast fill", data.outstandingFastFillBalanceUsd],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {typeof value === "number" && Number.isFinite(value)
                      ? new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 2,
                        }).format(value)
                      : "Unavailable"}
                  </strong>
                </div>
              ))}
            </div>
          )}
          {loading ? (
            <div className="resource-loading" role="status">
              <Loader2 className="spin" />
              Loading account data…
            </div>
          ) : error ? (
            <div className="resource-empty" role="alert">
              <CircleHelp size={28} />
              <h3>Account data is unavailable</h3>
              <p>{error}</p>
              <button onClick={() => setReload((n) => n + 1)}>Try again</button>
            </div>
          ) : !session ? (
            <div className="resource-empty">
              <Wallet size={30} />
              <h3>Sign in to view your balance</h3>
              <p>
                Use your own wallet to read its account data. No sample balances
                are displayed here.
              </p>
              <button className="resource-primary-button" onClick={onAccount}>
                Connect & sign in
                <ArrowRight size={17} />
              </button>
            </div>
          ) : data && data.balances.length ? (
            <>
              <ul className="resource-balances">
                {data.balances.map((b, i) => (
                  <li
                    key={`${b.currency?.chainId}-${b.currency?.address}-${b.hubTokenId || i}`}
                  >
                    <span>
                      <strong>
                        {b.currency?.symbol || "Unidentified asset"}
                      </strong>
                      <small>
                        {b.currency
                          ? `Chain ${b.currency.chainId}`
                          : "Metadata unavailable"}
                      </small>
                    </span>
                    <span>
                      <strong>
                        {b.amountFormatted ?? "Amount metadata unavailable"}
                      </strong>
                      <small>
                        {b.amountFormatted === null
                          ? `${b.amount} base units`
                          : b.amountUsd === null
                            ? "USD estimate unavailable"
                            : `Provider estimate: $${b.amountUsd}`}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              {data.hasMore && (
                <p className="resource-help">
                  More balances are available. Open the provider workspace for
                  the complete account.
                </p>
              )}
              <p className="resource-help">
                Read {new Date(data.fetchedAt).toLocaleString()} ·
                provider-reported balances
              </p>
            </>
          ) : (
            <div className="resource-empty">
              <Wallet size={28} />
              <h3>No balances returned</h3>
              <p>
                {recovery
                  ? "The provider returned no recovery balances for this owner account. A deposit may still need verification."
                  : "The provider returned no app funds for this wallet."}
              </p>
            </div>
          )}
        </section>
      ) : (
        <section className="resource-panel">
          <h2>{recovery ? "Recover a deposit" : "Two balance components"}</h2>
          {recovery ? (
            <ol className="resource-steps">
              <li>
                <strong>Locate the deposit</strong>
                <p>
                  Find the source chain and full transaction hash in your wallet
                  or explorer.
                </p>
              </li>
              <li>
                <strong>Verify on Relay</strong>
                <p>
                  Open Verify & Withdraw and submit those details. Verification
                  can be pending; it does not by itself withdraw funds.
                </p>
              </li>
              <li>
                <strong>Review the withdrawal</strong>
                <p>
                  Connect the owner wallet and review the available assets,
                  target network, fees, and exact wallet request. Withdrawal
                  history is available in the provider flow.
                </p>
              </li>
            </ol>
          ) : (
            <div className="resource-card-grid">
              <div>
                <h3>Earned app fees</h3>
                <p>
                  Configured integrator fees may accrue in the provider’s app
                  balance. They are not trading profit or a wallet deposit.
                </p>
              </div>
              <div>
                <h3>Sponsorship funds</h3>
                <p>
                  Separately deposited funds may cover eligible transaction fees
                  when sponsorship is configured for your application.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
      <div className="resource-actions">
        <ReferenceLink href={official}>
          {recovery
            ? "Open verification & withdrawal on Relay"
            : "Manage app funds on Relay"}
        </ReferenceLink>
        <ReferenceLink
          href={
            recovery
              ? "https://docs.relay.link/references/protocol/guides/withdrawals"
              : "https://docs.relay.link/references/api/get-app-fee-balances"
          }
        >
          Read the guide
        </ReferenceLink>
      </div>
    </>
  );
}
function Legal({ privacy }: { privacy: boolean }) {
  return (
    <>
      <Intro
        eyebrow="APP RESOURCES / HOPLANE"
        title={privacy ? "Privacy overview" : "Preview terms of use"}
      >
        {privacy
          ? "How this version of Hoplane handles account and application data."
          : "The boundaries of the current Hoplane preview and its connected services."}
      </Intro>
      <article className="resource-legal">
        {privacy ? (
          <>
            <h2>Wallet-linked data</h2>
            <p>
              Signing in associates your wallet address with a server session,
              preferences, favorites, quotes, and transfer records. Hoplane does
              not ask for wallet seed phrases or private keys.
            </p>
            <h2>Storage and retention</h2>
            <p>
              Sessions expire after their configured lifetime, normally 24
              hours. Quotes are retained for 24 hours and transfer records for
              90 days. Preferences remain until removed by account
              administration. Demo preferences and sample activity stay in
              browser storage. Provider-facing account lookups use the signed-in
              wallet address.
            </p>
            <h2>Providers and technical data</h2>
            <p>
              Relay receives information required for quotes, tracking, and
              account lookups. Configured RPC providers receive balance and
              transaction queries. Hosting and security systems process
              connection metadata and request logs. Fonts and asset hosts can
              receive ordinary network information when their resources load.
            </p>
            <h2>Your controls</h2>
            <p>
              You can sign out to invalidate your session and clear this site’s
              local storage to remove local demo data. There is no self-service
              server-data deletion or export tool in this version. Operator
              contact details and a reviewed production privacy policy are
              required before a funds-enabled release.
            </p>
          </>
        ) : (
          <>
            <h2>Preview and availability</h2>
            <p>
              Hoplane is an independent application using Relay’s services. Demo
              mode simulates activity and does not transfer funds. Live features
              depend on the deployment’s enabled services and supported routes.
            </p>
            <h2>Wallet authorization</h2>
            <p>
              You control your wallet. Review the network, recipient, asset,
              amount, minimum output, fees, and wallet request before
              confirming. A sign-in message creates an account session; it is
              separate from a transaction authorization.
            </p>
            <h2>External services</h2>
            <p>
              Provider dashboards, vault management, and recovery services open
              on their respective official sites and are governed by those
              operators’ policies. Hoplane does not promise execution, yield,
              uninterrupted availability, or a particular settlement time.
            </p>
            <h2>Release status</h2>
            <p>
              These preview usage notes describe the current application.
              Operator identity, support contact, applicable jurisdiction, and
              reviewed production terms must be established before a
              funds-enabled public release.
            </p>
          </>
        )}
        <p className="resource-help">Updated {RELAY_REFERENCE_CHECKED_AT}</p>
      </article>
    </>
  );
}
export default function ResourceView({ page, onNavigate, onAccount }: Props) {
  const guide = guides[page];
  return (
    <section className="resource-shell" aria-label="Application resources">
      {page === "documentation" ? (
        <Documents />
      ) : page === "api-reference" ? (
        <Documents apiOnly />
      ) : page === "status" ? (
        <ServiceStatus />
      ) : page === "testnets" ? (
        <Testnets onNavigate={onNavigate} />
      ) : page === "explorer" ? (
        <Explorer />
      ) : page === "app-balance" || page === "withdraw" ? (
        <AccountResource
          key={page}
          recovery={page === "withdraw"}
          onAccount={onAccount}
        />
      ) : page === "terms" || page === "privacy" ? (
        <Legal privacy={page === "privacy"} />
      ) : guide ? (
        <>
          <Intro eyebrow={guide.eyebrow} title={guide.title}>
            {guide.description}
          </Intro>
          <div className="resource-notice">
            <Layers size={21} />
            <p>{guide.availability}</p>
          </div>
          <div className="resource-card-grid">
            {guide.items.map(([title, body], i) => (
              <section className="resource-panel" key={title}>
                <span className="resource-step">0{i + 1}</span>
                <h2>{title}</h2>
                <p>{body}</p>
              </section>
            ))}
          </div>
          <div className="resource-actions">
            <button
              className="resource-primary-button"
              onClick={() =>
                onNavigate(
                  page === "product-app" || page === "solutions-wallets"
                    ? "swap"
                    : "documentation",
                )
              }
            >
              {page === "product-app" || page === "solutions-wallets"
                ? "Open Hoplane"
                : "Browse documentation"}
              <ArrowRight size={18} />
            </button>
            <ReferenceLink href={guide.url}>{guide.link}</ReferenceLink>
          </div>
          <section className="resource-related">
            <h2>Continue exploring</h2>
            <div>
              {usefulDocs(guide.categories).map((d) => (
                <a href={d.url} {...external} key={d.id}>
                  <BookOpen size={19} />
                  <span>{d.title}</span>
                  <ExternalLink size={15} />
                </a>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <Intro eyebrow="RESOURCES" title="Find your next step.">
            Explore product guides and documentation.
          </Intro>
          <button
            className="resource-primary-button"
            onClick={() => onNavigate("documentation")}
          >
            Browse documentation
            <ArrowRight size={18} />
          </button>
        </>
      )}
    </section>
  );
}
