import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api } from "../lib/backend";
import {
  API_ENDPOINTS,
  CONSOLE_PATHS,
  TESTNETS,
} from "../../server/developer-reference";
import type { DeveloperRuntime } from "../../server/developer-reference";
import "./developers.css";

type Page =
  "documentation" | "api-reference" | "testnets" | "explorer" | "status";
export const DEVELOPER_PAGES: Page[] = [
  "documentation",
  "api-reference",
  "testnets",
  "explorer",
  "status",
];
const labels = [
  "Documentation",
  "API Reference",
  "Testnets",
  "Chain Explorer",
  "API Status",
];
const repo = "https://github.com/miku0027-ops/crypto_swap_app/blob/main/";
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
const link = (url: string, label: string) => (
  <a className="dev-link" href={url} {...external}>
    {label}
    <ArrowUpRight size={14} />
  </a>
);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function runtimeValue(v: unknown): DeveloperRuntime {
  if (
    !record(v) ||
    !["hoplane-api", "hoplane-public-api"].includes(String(v.service)) ||
    !["backend", "public-preview"].includes(String(v.profile)) ||
    !Number.isSafeInteger(v.checkedAt) ||
    Number(v.checkedAt) <= 0 ||
    Number(v.checkedAt) > Date.now() + 300000 ||
    !record(v.capabilities) ||
    !["publicActivity", "quotes", "execution", "balances", "sync"].every(
      (k) =>
        typeof (v.capabilities as Record<string, unknown>)[k] === "boolean",
    ) ||
    !Array.isArray(v.testnetChainIds) ||
    v.testnetChainIds.length > 100 ||
    !v.testnetChainIds.every((n) => Number.isSafeInteger(n) && n > 0) ||
    typeof v.providerKeyConfigured !== "boolean"
  )
    throw new Error(
      "The deployment returned incomplete capability information.",
    );
  return v as DeveloperRuntime;
}
function useRuntime() {
  const [runtime, setRuntime] = useState<DeveloperRuntime | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setRuntime(null);
    api<unknown>("/developer/status", { signal: c.signal, timeoutMs: 8000 })
      .then((v) => {
        if (!c.signal.aborted) setRuntime(runtimeValue(v));
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Deployment information is unavailable.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [revision]);
  return {
    runtime,
    error,
    loading,
    revision,
    recheck: () => setRevision((n) => n + 1),
  };
}
const guides = [
  {
    id: "start",
    title: "Start building with Hoplane",
    topic: "Getting started",
    summary: "Understand the public preview, backend, and provider connection.",
    sections: [
      [
        "Choose the right API",
        "Hoplane’s /api routes validate application policy and own wallet sessions, preferences and transfer history. Relay is the route and settlement provider. Browser applications call Hoplane; provider keys stay on the server.",
      ],
      [
        "Inspect this deployment",
        "API Status reports this host’s capabilities. The published preview runs public transaction snapshots and streaming. Wallet sign-in, quotes, balances and sync require the Node backend deployed to GCP.",
      ],
      [
        "Make a first request",
        "Open API Reference and run GET /developer/status in the read-only tester. It returns the deployment profile and configured capabilities without requesting a wallet signature.",
      ],
    ],
    code: "GET /api/developer/status\nGET /api/transactions\nGET /api/developer/openapi.json",
  },
  {
    id: "wallets",
    title: "Wallet sessions and identity",
    topic: "Authentication",
    summary: "Sign in with Ethereum and isolate account data.",
    sections: [
      [
        "Sign a server challenge",
        "POST /auth/challenge creates a five-minute, single-use Sign-In with Ethereum message. Check the domain, URI, address, chain, statement and expiry before asking the wallet to sign.",
      ],
      [
        "Use the verified session",
        "POST /auth/verify sets an HTTP-only cookie and returns a CSRF token. Authenticated writes need X-CSRF-Token, an allowed Origin and JSON Content-Type. Production uses the __session cookie; local development uses hoplane_session.",
      ],
      [
        "Handle account changes",
        "Invalidate visible account data when the wallet changes, the session expires or the user signs out. The server binds private reads to the session owner; clients cannot select another owner.",
      ],
    ],
  },
  {
    id: "quotes",
    title: "Quotes, review and settlement",
    topic: "Trading",
    summary: "Follow the validated request lifecycle and execution policy.",
    sections: [
      [
        "Discover assets first",
        "GET /chains and POST /currencies return permitted networks and curated token metadata. Amounts are integer base-unit strings, never floating-point token values.",
      ],
      [
        "Review a fresh quote",
        "POST /quotes checks the wallet, network, token pair, amount, recipient and slippage. Prepare an unexpired executable quote using a UUID Idempotency-Key, then reauthorize the exact step before a user-confirmed broadcast.",
      ],
      [
        "Track independently",
        "Report the broadcast transactionHash to the transfer endpoint. RPC verification checks sender, chain, target, calldata and value. Provider settlement remains a dependency; a source transaction is not proof of destination receipt. Router calls, approvals, permits and unsupported multistep routes remain blocked.",
      ],
    ],
  },
  {
    id: "activity",
    title: "Public activity and wallet history",
    topic: "Activity",
    summary: "Integrate real network snapshots and server-sent events.",
    sections: [
      [
        "Keep the sources clear",
        "GET /transactions returns the latest 50 accessible Relay network requests, including activity from other apps. This sample is not Hoplane trading volume. GET /transfers instead returns only the signed-in wallet’s Hoplane transfers.",
      ],
      [
        "Stream updates",
        "GET /transactions/stream sends snapshot and feed-error events with heartbeats. Respect the reported refresh interval, provider cooldowns and connection limits. Pause when hidden and retain the last real snapshot during outages.",
      ],
      [
        "Prepare for the API migration",
        "Without a server key, the current public feed refreshes every 60 seconds. Relay retires Requests v2 on November 24, 2026. A server-side RELAY_API_KEY selects v3 with 10-second shared snapshots. Never put this key in VITE_* variables or browser code.",
      ],
    ],
    code: "const stream = new EventSource('/api/transactions/stream');\nstream.addEventListener('snapshot', event => {\n  const snapshot = JSON.parse(event.data);\n  // Validate, display the source, and preserve exact amounts.\n});\n// Close this connection when the view unmounts or is hidden.\n// stream.close();",
  },
  {
    id: "testnets",
    title: "Test safely before mainnet",
    topic: "Testing",
    summary: "Check candidate chains, liquidity and configured capabilities.",
    sections: [
      [
        "Demo and testnet differ",
        "Demo is a browser simulation. Testnet is real wallet-signed activity using test tokens. In the live swap workspace choose Testnet before selecting a route.",
      ],
      [
        "Check configuration",
        "Ethereum Sepolia (11155111) and Base Sepolia (84532) are default candidates. The backend intersects its allowlist with provider metadata. A listed chain does not establish liquidity, quote access, RPC verification or an approved execution target.",
      ],
      [
        "Review each transaction",
        "Get test funds through the chain’s official resources. Use a fresh quote and inspect the recipient and minimum output before signing. Mainnet and transaction execution are disabled by default until the operator configures and verifies them.",
      ],
    ],
  },
  {
    id: "vaults",
    title: "Vault data and withdrawals",
    topic: "Vaults",
    summary:
      "Read existing positions and preserve the provider wind-down context.",
    sections: [
      [
        "Read positions accurately",
        "GET /vaults returns indexed metadata and metrics. Authenticated GET /vaults/positions returns shares for the verified wallet. Share balances do not establish immediately withdrawable underlying assets.",
      ],
      [
        "Understand freshness",
        "Pool snapshots and wallet activity timestamps have different meanings. USD values use optional token pricing; missing values stay unavailable. APY is provider-reported historical yield, not a guaranteed return.",
      ],
      [
        "Respect retirement",
        "Relay vaults are winding down and deposits are closed. Its withdrawal UI is scheduled to retire on December 31, 2026; the provider documents direct contract withdrawals afterward. Hoplane links to that flow rather than signing withdrawals.",
      ],
    ],
  },
  {
    id: "deployment",
    title: "Deploy the backend and sync accounts",
    topic: "Deployment",
    summary: "GCP, Firebase, secrets and cross-device account ownership.",
    sections: [
      [
        "Use the project architecture",
        "The repository targets Firebase project hoplane-b9ac1, with a Node 24 API on Cloud Run and Firestore persistence. Use the same-origin Firebase rewrite or serve the SPA and API together to preserve cookie authentication.",
      ],
      [
        "Keep secrets server-side",
        "Relay keys and credential-bearing RPC settings belong in Secret Manager or encrypted server runtime secrets. Firebase web configuration is public client configuration and does not authorize backend deployment.",
      ],
      [
        "Sync verified wallets",
        "Sign in with the same wallet on each device to read account settings and favorites. Version checks protect concurrent updates. Native Android and Chrome extension clients are planned; the current implementation is the responsive web app.",
      ],
    ],
  },
];
function CopyCode({ value }: { value: string }) {
  const [notice, setNotice] = useState("");
  return (
    <div className="dev-code">
      <button
        aria-label="Copy code example"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setNotice("Copied");
          } catch {
            setNotice("Copy unavailable. Select the example below.");
          }
        }}
      >
        <Copy size={14} />
        {notice || "Copy"}
      </button>
      <pre>
        <code>{value}</code>
      </pre>
    </div>
  );
}
function Library({ references }: { references: ReactNode }) {
  const [source, setSource] = useState("hoplane"),
    [selected, setSelected] = useState("start"),
    [query, setQuery] = useState("");
  const filtered = guides.filter((g) =>
    `${g.title} ${g.topic} ${g.summary}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const guide = guides.find((g) => g.id === selected)!;
  return (
    <>
      <div
        className="dev-switch"
        role="group"
        aria-label="Documentation source"
      >
        <button
          aria-pressed={source === "hoplane"}
          onClick={() => setSource("hoplane")}
        >
          Hoplane guides
        </button>
        <button
          aria-pressed={source === "relay"}
          onClick={() => setSource("relay")}
        >
          Relay references <ArrowUpRight size={13} />
        </button>
      </div>
      {source === "relay" ? (
        <section aria-label="Relay references">{references}</section>
      ) : (
        <>
          <label className="dev-search">
            <Search size={18} />
            <input
              aria-label="Search Hoplane guides"
              placeholder="Search authentication, activity, deployment…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="dev-doc-layout">
            <nav aria-label="Hoplane guide navigation">
              {filtered.map((g) => (
                <button
                  key={g.id}
                  aria-current={guide.id === g.id ? "page" : undefined}
                  onClick={() => setSelected(g.id)}
                >
                  <span>{g.topic}</span> <strong>{g.title}</strong>
                </button>
              ))}
              {!filtered.length && (
                <p>
                  No matching guides.{" "}
                  <button onClick={() => setQuery("")}>Clear search</button>
                </p>
              )}
            </nav>
            <article className="dev-article">
              <span className="dev-eyebrow">
                HOPLANE / {guide.topic.toUpperCase()}
              </span>
              <h2>{guide.title}</h2>
              <p className="dev-lead">{guide.summary}</p>
              {guide.sections.map(([heading, text]) => (
                <section key={heading}>
                  <h3>{heading}</h3>
                  <p>{text}</p>
                </section>
              ))}
              {"code" in guide && guide.code && <CopyCode value={guide.code} />}
              <div className="dev-article-source">
                {link(
                  repo + "docs/BACKEND.md",
                  "Implementation and backend contract",
                )}
              </div>
            </article>
          </div>
        </>
      )}
    </>
  );
}
function ApiReference({ references }: { references: ReactNode }) {
  const [source, setSource] = useState("hoplane"),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState("All"),
    [path, setPath] = useState<string>(CONSOLE_PATHS[0]),
    [result, setResult] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const endpoints = API_ENDPOINTS.filter(
    (e) =>
      (group === "All" || e.group === group) &&
      `${e.method} ${e.path} ${e.title} ${e.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const run = async () => {
    if (
      requestController.current ||
      busy ||
      !CONSOLE_PATHS.includes(path as (typeof CONSOLE_PATHS)[number])
    )
      return;
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const v = await api<unknown>(path, {
        timeoutMs: 10000,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const text = JSON.stringify(v, null, 2);
      setResult(
        text.length > 12000
          ? text.slice(0, 12000) + "\n… Preview truncated at 12,000 characters."
          : text,
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "The request could not be completed.",
        );
    } finally {
      requestController.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <>
      <div
        className="dev-switch"
        role="group"
        aria-label="API reference source"
      >
        <button
          aria-pressed={source === "hoplane"}
          onClick={() => setSource("hoplane")}
        >
          Hoplane API
        </button>
        <button
          aria-pressed={source === "relay"}
          onClick={() => setSource("relay")}
        >
          Relay provider API <ArrowUpRight size={13} />
        </button>
      </div>
      {source === "relay" ? (
        <section aria-label="Relay API references">{references}</section>
      ) : (
        <>
          <div className="dev-actions">
            <a
              className="dev-button"
              href="/api/developer/openapi.json"
              download="hoplane-openapi.json"
            >
              <Download size={15} />
              Download OpenAPI
            </a>
            {link(repo + "docs/BACKEND.md", "Read our API contract")}
          </div>
          <div className="dev-note">
            <ShieldCheck size={18} />
            <p>
              All paths use the <code>/api</code> prefix. Public activity and
              developer endpoints run on this preview. Account and trading
              routes require the GCP backend. Writes need an allowed Origin and
              JSON; authenticated writes also need a wallet session and CSRF
              token.
            </p>
          </div>
          <section className="dev-console" aria-labelledby="console-title">
            <h2 id="console-title">Try a read-only request</h2>
            <p>
              Choose a fixed public GET endpoint. This tester never requests a
              wallet signature or sends a transaction.
            </p>
            <div className="dev-console-controls">
              <label>
                Endpoint
                <select
                  aria-label="Read-only API endpoint"
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setResult("");
                    setError("");
                  }}
                  disabled={busy}
                >
                  {CONSOLE_PATHS.map((p) => (
                    <option key={p} value={p}>
                      GET /api{p}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="dev-button primary"
                onClick={() => void run()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Code2 size={15} />
                )}{" "}
                {busy ? "Running…" : "Run GET request"}
              </button>
            </div>
            {error && (
              <p className="dev-error" role="alert">
                {error}
              </p>
            )}
            {result && (
              <div role="region" aria-label="API response">
                <CopyCode value={result} />
              </div>
            )}
          </section>
          <div className="dev-api-toolbar">
            <label className="dev-search">
              <Search size={18} />
              <input
                aria-label="Search Hoplane endpoints"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search endpoints or authentication…"
              />
            </label>
            <select
              aria-label="API endpoint category"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option>All</option>
              {[...new Set(API_ENDPOINTS.map((e) => e.group))].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </div>
          <p className="dev-count">
            {endpoints.length} endpoints · examples describe the request shape;
            server validation remains authoritative.
          </p>
          <div className="dev-endpoints">
            {endpoints.map((e) => (
              <details key={e.method + e.path}>
                <summary>
                  <span className={`dev-method ${e.method.toLowerCase()}`}>
                    {e.method}
                  </span>
                  <code>/api{e.path}</code>
                  <span className="dev-endpoint-title">{e.title}</span>
                </summary>
                <div className="dev-endpoint-body">
                  <div className="dev-tags">
                    <span>
                      {e.auth === "public"
                        ? "Public"
                        : e.auth === "optional-wallet"
                          ? "Optional wallet session"
                          : e.auth === "wallet-csrf"
                            ? "Wallet + CSRF"
                            : "Wallet session"}
                    </span>
                    <span>
                      {e.host === "both" ? "Preview + backend" : "GCP backend"}
                    </span>
                  </div>
                  <p>{e.description}</p>
                  {e.query?.map((q) => (
                    <p key={q.name}>
                      <code>{q.name}</code>
                      {q.required ? " (required)" : " (optional)"}:{" "}
                      {q.description} Example: <code>{q.example}</code>.
                    </p>
                  ))}
                  {e.example && (
                    <CopyCode value={JSON.stringify(e.example, null, 2)} />
                  )}
                </div>
              </details>
            ))}
          </div>
          {!endpoints.length && (
            <div className="dev-note">
              No matching endpoints.{" "}
              <button
                onClick={() => {
                  setSearch("");
                  setGroup("All");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
function Testnets({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { runtime, error, loading, recheck } = useRuntime();
  return (
    <>
      <div className="dev-note">
        <ShieldCheck size={19} />
        <p>
          Demo mode uses sample data. Testnet mode uses real wallet-signed
          transactions with test tokens. In the live swap workspace, explicitly
          select <b>Testnet</b> before reviewing a quote.
        </p>
      </div>
      <div className="dev-check-line">
        <span>
          {loading
            ? "Checking this deployment…"
            : runtime?.profile === "public-preview"
              ? "Public preview · testnet trading is not deployed here"
              : runtime
                ? "Candidate chains reported by the backend"
                : error || "Configuration unavailable"}
        </span>
        <button className="dev-button" disabled={loading} onClick={recheck}>
          <RefreshCw size={14} />
          Recheck
        </button>
      </div>
      <div className="dev-testnet-grid">
        {TESTNETS.map((n) => (
          <article key={n.id} className="dev-network">
            <span className="dev-eyebrow">TEST NETWORK</span>
            <h2>{n.name}</h2>
            <span className="dev-tag">
              {runtime?.testnetChainIds.includes(n.id)
                ? "Configured candidate"
                : runtime
                  ? "Not configured on this host"
                  : "Configuration unknown"}
            </span>
            <dl>
              <div>
                <dt>Chain ID</dt>
                <dd>
                  <code>{n.id}</code>
                </dd>
              </div>
              <div>
                <dt>Gas token</dt>
                <dd>{n.currency}</dd>
              </div>
            </dl>
            {link(n.explorer, "Open " + n.name + " explorer")}
          </article>
        ))}
      </div>
      <section className="dev-article">
        <h2>Testnet checklist</h2>
        <ol>
          <li>
            Deploy the Node backend and configure your server-side Relay key.
          </li>
          <li>
            Enable candidate chains, their RPC verification and reviewed deposit
            targets.
          </li>
          <li>
            Choose Live, then Testnet in the swap workspace; sign in with your
            test wallet.
          </li>
          <li>
            Fetch a current route, confirm liquidity, and review recipient,
            minimum output and expiry.
          </li>
          <li>
            Confirm each transaction in the wallet and inspect the source and
            destination explorer records.
          </li>
        </ol>
        <p>
          Listed chains do not guarantee provider liquidity or an executable
          route. Hoplane supports reviewed EVM deposits; mainnet and execution
          are disabled by default.
        </p>
        <div className="dev-actions">
          <button
            className="dev-button primary"
            onClick={() => onNavigate("swap")}
          >
            Open swap workspace <ArrowRight size={15} />
          </button>
          {link(
            "https://docs.relay.link/references/api/api_guides/testnet",
            "Provider testnet guide",
          )}
          {link("https://testnets.relay.link/", "Relay testnet app")}
        </div>
      </section>
    </>
  );
}
const explorerNetworks = [
  { id: "1", name: "Ethereum", url: "https://etherscan.io" },
  { id: "8453", name: "Base", url: "https://basescan.org" },
  { id: "42161", name: "Arbitrum", url: "https://arbiscan.io" },
  { id: "10", name: "Optimism", url: "https://optimistic.etherscan.io" },
  { id: "137", name: "Polygon", url: "https://polygonscan.com" },
  { id: "56", name: "BNB Chain", url: "https://bscscan.com" },
  { id: "43114", name: "Avalanche", url: "https://snowtrace.io" },
  {
    id: "11155111",
    name: "Ethereum Sepolia",
    url: "https://sepolia.etherscan.io",
  },
  { id: "84532", name: "Base Sepolia", url: "https://sepolia.basescan.org" },
];
function Explorer({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [value, setValue] = useState(""),
    [network, setNetwork] = useState("1");
  const v = value.trim(),
    kind = /^0x[\da-fA-F]{64}$/.test(v)
      ? "tx"
      : /^0x[\da-fA-F]{40}$/.test(v)
        ? "address"
        : null,
    n = explorerNetworks.find((n) => n.id === network)!;
  return (
    <>
      <section className="dev-console">
        <h2>Inspect a transaction or wallet</h2>
        <p>
          Choose the chain used by the transaction. This lookup opens an
          independent explorer and does not connect your wallet.
        </p>
        <div className="dev-console-controls">
          <label>
            Network
            <select
              aria-label="Explorer network"
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
            >
              {explorerNetworks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dev-grow">
            EVM transaction hash or address
            <input
              aria-label="Transaction hash or address"
              value={value}
              maxLength={256}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0x…"
              aria-invalid={!!value && !kind}
              aria-describedby="dev-explorer-help"
            />
          </label>
        </div>
        <p
          id="dev-explorer-help"
          className={value && !kind ? "dev-error" : "dev-muted"}
        >
          {value && !kind
            ? "Enter a complete EVM address or 66-character transaction hash."
            : "Network selection is required; the same address can exist on multiple chains."}
        </p>
        {kind && link(`${n.url}/${kind}/${v}`, "View on " + n.name)}
      </section>
      <div className="dev-testnet-grid">
        <section className="dev-article">
          <h2>Hoplane transaction activity</h2>
          <p>
            Follow public Relay network requests, then open their origin and
            destination transaction links. Your Hoplane wallet history remains
            separate.
          </p>
          <button
            className="dev-button primary"
            onClick={() => onNavigate("activity")}
          >
            Open transactions <ArrowRight size={15} />
          </button>
        </section>
        <section className="dev-article">
          <h2>Relay Chain Explorer</h2>
          <p>
            Relay operates its own protocol-chain explorer. This external
            service is distinct from Hoplane’s transaction history and the
            source/destination chain explorers.
          </p>
          {link(
            "https://explorer.chain.relay.link/",
            "Open Relay Chain Explorer",
          )}
        </section>
      </div>
    </>
  );
}
type Probe = {
  state: "checking" | "ok" | "unavailable";
  text: string;
  checkedAt?: number;
  latency?: number;
};
function ServiceStatus() {
  const { runtime, error, loading, revision, recheck } = useRuntime(),
    [feed, setFeed] = useState<Probe>({
      state: "checking",
      text: "Waiting for deployment information",
    }),
    [storage, setStorage] = useState<Probe>({
      state: "checking",
      text: "Waiting for deployment information",
    });
  useEffect(() => {
    if (!runtime) return;
    const c = new AbortController();
    setFeed({ state: "checking", text: "Reading a public snapshot…" });
    const started = performance.now();
    api<unknown>("/transactions", { signal: c.signal, timeoutMs: 10000 })
      .then((v) => {
        if (c.signal.aborted) return;
        if (
          !record(v) ||
          !Array.isArray(v.transactions) ||
          v.transactions.length > 50 ||
          !Number.isSafeInteger(v.fetchedAt) ||
          Number(v.fetchedAt) <= 0 ||
          Number(v.fetchedAt) > Date.now() + 300000 ||
          typeof v.providerDataOld !== "boolean" ||
          !record(v.source) ||
          v.source.name !== "Relay network"
        )
          throw new Error("The activity response could not be verified.");
        const old =
          Date.now() - Number(v.fetchedAt) > 300000 ||
          v.providerDataOld === true;
        setFeed({
          state: old ? "unavailable" : "ok",
          text: `${v.transactions.length} public records · snapshot ${new Date(Number(v.fetchedAt)).toLocaleTimeString()}${old ? " · indexed data delayed" : ""}`,
          checkedAt: Date.now(),
          latency: Math.round(performance.now() - started),
        });
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setFeed({
            state: "unavailable",
            text: e instanceof Error ? e.message : "Activity unavailable",
            checkedAt: Date.now(),
          });
      });
    if (runtime.profile === "backend") {
      setStorage({ state: "checking", text: "Checking persistence…" });
      const t = performance.now();
      api<unknown>("/ready", { signal: c.signal, timeoutMs: 8000 })
        .then((v) => {
          if (c.signal.aborted) return;
          if (!record(v) || v.status !== "ready")
            throw new Error("Storage readiness was not confirmed.");
          setStorage({
            state: "ok",
            text: "Backend storage read succeeded",
            checkedAt: Date.now(),
            latency: Math.round(performance.now() - t),
          });
        })
        .catch((e) => {
          if (!c.signal.aborted)
            setStorage({
              state: "unavailable",
              text: e instanceof Error ? e.message : "Storage unavailable",
              checkedAt: Date.now(),
            });
        });
    } else
      setStorage({
        state: "unavailable",
        text: "Account and trading services require the GCP backend; they are not deployed on this preview.",
      });
    return () => c.abort();
  }, [runtime, revision]);
  return (
    <>
      <div className="dev-check-line">
        <span>
          {runtime
            ? `${runtime.service} · ${runtime.profile === "backend" ? "GCP/backend profile" : "Public preview profile"}`
            : loading
              ? "Checking deployment…"
              : error}
        </span>
        <button
          className="dev-button"
          disabled={loading || (feed.state === "checking" && !!runtime)}
          onClick={recheck}
        >
          <RefreshCw size={15} />
          Check again
        </button>
      </div>
      <div className="dev-status-grid">
        {[
          {
            title: "Public activity API",
            probe: runtime
              ? feed
              : ({
                  state: loading ? "checking" : "unavailable",
                  text: error || "Checking deployment…",
                } as Probe),
          },
          {
            title: "Account & trading backend",
            probe: runtime
              ? storage
              : ({
                  state: loading ? "checking" : "unavailable",
                  text: error || "Checking deployment…",
                } as Probe),
          },
        ].map(({ title, probe }) => (
          <section key={title} className="dev-status-card">
            <span className={`dev-status-icon ${probe.state}`}>
              {probe.state === "ok" ? (
                <Check size={20} />
              ) : probe.state === "checking" ? (
                <Loader2 size={20} className="spin" />
              ) : (
                <Info size={20} />
              )}
            </span>
            <h2>{title}</h2>
            <strong>
              {probe.state === "ok"
                ? "Responding"
                : probe.state === "checking"
                  ? "Checking"
                  : "Unavailable on this check"}
            </strong>
            <p role="status">{probe.text}</p>
            {probe.checkedAt && (
              <small>
                Checked {new Date(probe.checkedAt).toLocaleTimeString()}
                {probe.latency !== undefined
                  ? ` · ${probe.latency} ms from this browser`
                  : ""}
              </small>
            )}
          </section>
        ))}
      </div>
      {runtime && (
        <section className="dev-console">
          <h2>Reported configuration</h2>
          <p>
            Configured features are not settlement or uptime guarantees.
            Execution still requires all route, wallet and RPC checks.
          </p>
          <div className="dev-capabilities">
            {Object.entries({
              quotes: "Quotes",
              execution: "Transaction execution",
              balances: "Wallet balances",
              sync: "Account sync",
            }).map(([k, label]) => (
              <div key={k}>
                <strong>{label}</strong>
                <span className="dev-tag">
                  {runtime.capabilities[k as keyof typeof runtime.capabilities]
                    ? "Configured"
                    : "Not enabled"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="dev-article">
        <h2>Relay provider status</h2>
        <p>
          Hoplane checks this deployment separately from Relay’s upstream
          infrastructure. Provider incident details and chain availability are
          reported on Relay’s official status page. These checks do not
          establish destination-chain finality.
        </p>
        {link("https://status.relay.link/", "Open official API status")}
      </section>
      <p className="dev-muted">
        Point-in-time checks only. No uptime percentage or SLA is inferred from
        this page. Public-feed rate limits appear as unavailable or delayed
        until the next successful check.
      </p>
    </>
  );
}
export default function DeveloperViews({
  page,
  onNavigate,
  references,
}: {
  page: Page;
  onNavigate: (page: string) => void;
  references: ReactNode;
}) {
  const descriptions = {
    documentation:
      "Guides for the app you’re building: identity, routes, activity, testnets and deployment.",
    "api-reference":
      "Hoplane endpoints, authentication requirements and safe request examples.",
    testnets:
      "Check the actual deployment and prepare a test-token route before mainnet.",
    explorer:
      "Inspect the chain evidence behind a Hoplane transfer or public Relay request.",
    status:
      "Check this deployment’s public activity and account services independently.",
  };
  return (
    <div className="developer-hub">
      <header className="dev-heading">
        <span className="dev-eyebrow">
          <Code2 size={14} /> HOPLANE / DEVELOPERS
        </span>
        <h1>{labels[DEVELOPER_PAGES.indexOf(page)]}</h1>
        <p>{descriptions[page]}</p>
      </header>
      <nav className="dev-navigation" aria-label="Developer pages">
        {DEVELOPER_PAGES.map((p, i) => (
          <button
            key={p}
            aria-current={page === p ? "page" : undefined}
            onClick={() => onNavigate(p)}
          >
            {labels[i]}
          </button>
        ))}
      </nav>
      {page === "documentation" ? (
        <Library references={references} />
      ) : page === "api-reference" ? (
        <ApiReference references={references} />
      ) : page === "testnets" ? (
        <Testnets onNavigate={onNavigate} />
      ) : page === "explorer" ? (
        <Explorer onNavigate={onNavigate} />
      ) : (
        <ServiceStatus />
      )}
    </div>
  );
}
