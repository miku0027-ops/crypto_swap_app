/** Public contract metadata shared by the Node API, Site Worker and developer UI. */
export type Endpoint = {
  method: "GET" | "POST" | "PUT";
  path: string;
  title: string;
  group: string;
  auth: "public" | "optional-wallet" | "wallet" | "wallet-csrf";
  host: "both" | "backend";
  description: string;
  example?: Record<string, unknown>;
  query?: {
    name: string;
    description: string;
    required?: boolean;
    example: string;
  }[];
};
const endpoint = (
  method: Endpoint["method"],
  path: string,
  title: string,
  group: string,
  auth: Endpoint["auth"],
  description: string,
  extra: Partial<Endpoint> = {},
): Endpoint => ({
  method,
  path,
  title,
  group,
  auth,
  host: "backend",
  description,
  ...extra,
});
export const API_ENDPOINTS: Endpoint[] = [
  endpoint(
    "GET",
    "/developer/status",
    "Deployment capabilities",
    "Diagnostics",
    "public",
    "Reports this host’s deployment profile, configured capabilities and candidate testnet IDs. It does not probe settlement or expose secrets.",
    { host: "both" },
  ),
  endpoint(
    "GET",
    "/developer/openapi.json",
    "OpenAPI document",
    "Diagnostics",
    "public",
    "Download the Hoplane API discovery contract, authentication requirements and request examples.",
    { host: "both" },
  ),
  endpoint(
    "GET",
    "/health",
    "Process health",
    "Diagnostics",
    "public",
    "Reports Node process liveness; it does not establish database or provider readiness.",
  ),
  endpoint(
    "GET",
    "/ready",
    "Storage readiness",
    "Diagnostics",
    "public",
    "Checks a backend storage read. A 503 response means persistence is unavailable.",
  ),
  endpoint(
    "GET",
    "/config",
    "Application configuration",
    "Diagnostics",
    "public",
    "Returns configured capabilities, trading networks, auth chain, quote policy and server time. No keys or RPC credentials.",
  ),
  endpoint(
    "GET",
    "/transactions",
    "Public network activity",
    "Activity",
    "public",
    "Latest 50 normalized public Relay requests, exact amounts, source/fetch timestamps and refresh interval. Search filters apply to loaded records in the UI.",
    { host: "both" },
  ),
  endpoint(
    "GET",
    "/transactions/stream",
    "Activity stream",
    "Activity",
    "public",
    "SSE snapshot and feed-error events, heartbeats, cancellation and paced reconnection. Upstream snapshots refresh at the reported interval.",
    { host: "both" },
  ),
  endpoint(
    "GET",
    "/chains",
    "Trading chains",
    "Trading",
    "public",
    "Returns enabled EVM trading chains intersected with current provider metadata.",
    {
      query: [
        {
          name: "network",
          description:
            "Trading environment; mainnet requires operator enablement.",
          example: "testnet",
        },
      ],
    },
  ),
  endpoint(
    "POST",
    "/currencies",
    "Currency discovery",
    "Trading",
    "public",
    "Curated token search, bounded to the server’s permitted chains.",
    {
      example: {
        network: "testnet",
        search: { chainIds: [11155111], term: "ETH", limit: 20 },
      },
    },
  ),
  endpoint(
    "POST",
    "/auth/challenge",
    "Wallet sign-in challenge",
    "Identity",
    "public",
    "Creates a single-use, five-minute SIWE challenge bound to this app’s origin and a nonzero EVM account.",
    {
      example: {
        address: "0x1111111111111111111111111111111111111111",
        chainId: 1,
      },
    },
  ),
  endpoint(
    "POST",
    "/auth/verify",
    "Verify wallet signature",
    "Identity",
    "public",
    "Verifies the server challenge and wallet signature, sets an HTTP-only session cookie and returns the session CSRF token.",
    {
      example: {
        challengeId: "<server challenge UUID>",
        signature: "<wallet-produced 65-byte signature>",
      },
    },
  ),
  endpoint(
    "GET",
    "/auth/session",
    "Current wallet session",
    "Identity",
    "optional-wallet",
    "Returns the current verified address/session or user:null. Never publish a session or CSRF token.",
  ),
  endpoint(
    "POST",
    "/auth/logout",
    "Sign out",
    "Identity",
    "wallet-csrf",
    "Revokes the current session and clears its cookie.",
    { example: {} },
  ),
  endpoint(
    "GET",
    "/preferences",
    "Read preferences",
    "Account",
    "wallet",
    "Reads only this wallet’s settings and favorites.",
  ),
  endpoint(
    "PUT",
    "/preferences",
    "Update preferences",
    "Account",
    "wallet-csrf",
    "Optimistic version checks prevent silent overwrites across devices; a conflict returns 409.",
    {
      example: {
        version: 0,
        settings: {
          theme: "light",
          slippageBps: 50,
          gasTopup: false,
          network: "testnet",
        },
        favorites: [],
      },
    },
  ),
  endpoint(
    "GET",
    "/vaults",
    "Vault catalog",
    "Vaults",
    "public",
    "Validated, read-only Relay vault metrics, sources, freshness and wind-down metadata. New deposits are closed.",
  ),
  endpoint(
    "GET",
    "/vaults/positions",
    "Wallet vault positions",
    "Vaults",
    "wallet",
    "Indexed shares for the authenticated wallet only. No caller-selected owner query.",
  ),
  endpoint(
    "GET",
    "/account/app-balance",
    "Integrator balances",
    "Account",
    "wallet",
    "Owner-scoped mainnet app-fee balances; not a wallet portfolio or claim endpoint.",
  ),
  endpoint(
    "GET",
    "/account/recovery-balances",
    "Recovery balances",
    "Account",
    "wallet",
    "Reads credited Relay Hub balances for this verified owner; performs no recovery transaction.",
    {
      query: [
        {
          name: "ownerChainId",
          description:
            "Relay Hub owner-account chain; independent of the trading environment.",
          required: true,
          example: "1",
        },
      ],
    },
  ),
  endpoint(
    "POST",
    "/quotes",
    "Create validated quote",
    "Trading",
    "wallet-csrf",
    "Creates an owner-bound quote after chain, asset, amount, recipient, slippage and execution-policy checks.",
    {
      example: {
        network: "testnet",
        quote: {
          user: "0x1111111111111111111111111111111111111111",
          originChainId: 11155111,
          destinationChainId: 84532,
          originCurrency: "0x0000000000000000000000000000000000000000",
          destinationCurrency: "0x0000000000000000000000000000000000000000",
          amount: "1000000000000000",
          tradeType: "EXACT_INPUT",
          slippageTolerance: "50",
        },
      },
    },
  ),
  endpoint(
    "POST",
    "/relay/quote",
    "Quote compatibility alias",
    "Trading",
    "wallet-csrf",
    "Alias for POST /quotes, with the same validation and ownership policy.",
  ),
  endpoint(
    "POST",
    "/quotes/{id}/prepare",
    "Prepare reviewed quote",
    "Trading",
    "wallet-csrf",
    "Requires Idempotency-Key. Persists a transfer from an unexpired, executable quote; does not broadcast a wallet transaction.",
    { example: {} },
  ),
  endpoint(
    "POST",
    "/transfers/{id}/authorize",
    "Reauthorize transfer step",
    "Trading",
    "wallet-csrf",
    "Rechecks owner, expiry, current policy and step commitments immediately before a user-approved broadcast.",
    { example: { stepIndex: 0 } },
  ),
  endpoint(
    "POST",
    "/transfers/{id}/transactions",
    "Track a source transaction",
    "Trading",
    "wallet-csrf",
    "Records a source hash only after RPC verification against the prepared sender, chain, target, data and value.",
    {
      example: {
        stepIndex: 0,
        transactionHash: "<broadcast EVM transaction hash>",
      },
    },
  ),
  endpoint(
    "GET",
    "/transfers",
    "Wallet transfer history",
    "Activity",
    "wallet",
    "Latest 50 persisted transfers belonging to this verified account; independent of public network activity.",
  ),
  endpoint(
    "GET",
    "/transfers/{id}",
    "Track wallet transfer",
    "Activity",
    "wallet",
    "Refreshes an owner-scoped transfer’s provider status. A source hash alone is not destination settlement.",
  ),
  endpoint(
    "POST",
    "/balances",
    "Read selected balances",
    "Account",
    "wallet-csrf",
    "Reads native/ERC-20 balances through operator-configured RPCs. Exact base units; partial errors remain explicit.",
    {
      example: {
        network: "testnet",
        chainId: 11155111,
        currencies: ["0x0000000000000000000000000000000000000000"],
      },
    },
  ),
];
export const CONSOLE_PATHS = [
  "/developer/status",
  "/transactions",
  "/health",
  "/ready",
  "/config",
  "/chains?network=testnet",
] as const;
export const TESTNETS = [
  {
    id: 11155111,
    name: "Ethereum Sepolia",
    currency: "Sepolia ETH",
    explorer: "https://sepolia.etherscan.io",
  },
  {
    id: 84532,
    name: "Base Sepolia",
    currency: "Sepolia ETH",
    explorer: "https://sepolia.basescan.org",
  },
] as const;
export type DeveloperRuntime = {
  service: "hoplane-api" | "hoplane-public-api";
  profile: "backend" | "public-preview";
  checkedAt: number;
  capabilities: {
    publicActivity: boolean;
    quotes: boolean;
    execution: boolean;
    balances: boolean;
    sync: boolean;
  };
  testnetChainIds: number[];
  providerKeyConfigured: boolean;
};
export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of API_ENDPOINTS) {
    const writes = e.method !== "GET";
    const parameters = [
      ...(e.path.includes("{id}")
        ? [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ]
        : []),
      ...(e.query ?? []).map((q) => ({
        name: q.name,
        in: "query",
        required: !!q.required,
        description: q.description,
        schema: { type: "string" },
        example: q.example,
      })),
      ...(e.path === "/quotes/{id}/prepare"
        ? [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ]
        : []),
    ];
    paths[e.path] ??= {};
    paths[e.path][e.method.toLowerCase()] = {
      summary: e.title,
      description: e.description,
      tags: [e.group],
      "x-hoplane-host": e.host,
      parameters,
      security:
        e.auth === "public"
          ? []
          : e.auth === "optional-wallet"
            ? [{}, { walletSession: [] }]
            : [
                {
                  walletSession: [],
                  ...(e.auth === "wallet-csrf" ? { csrfToken: [] } : {}),
                },
              ],
      ...(writes
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object" },
                  ...(e.example ? { example: e.example } : {}),
                },
              },
            },
          }
        : {}),
      responses: {
        "200": {
          description: e.path.endsWith("/stream")
            ? "SSE stream with snapshot/feed-error events."
            : "Successful validated response; see the backend contract for detailed field schemas.",
          ...(e.path.endsWith("/stream")
            ? {
                content: {
                  "text/event-stream": { schema: { type: "string" } },
                },
              }
            : {}),
        },
        "400": { description: "Invalid input or unexpected parameters." },
        ...(e.auth.includes("wallet")
          ? {
              "401": { description: "Verified wallet session required." },
              "403": {
                description: "Origin, CSRF, owner or policy check failed.",
              },
            }
          : {}),
        "429": { description: "Rate limit reached; observe Retry-After." },
        "503": {
          description: "Service, configuration or provider unavailable.",
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Hoplane API",
      version: "1.0.0",
      description:
        "API discovery and request examples for Hoplane. Schemas here are intentionally broad; server validation and the repository backend contract define field-level constraints. Production sessions use __session; local development uses hoplane_session. All writes require an allowed Origin and JSON Content-Type. The preview hosts public activity and developer metadata only. No wallet transaction is broadcast by this reference.",
    },
    servers: [{ url: "/api" }],
    paths,
    components: {
      securitySchemes: {
        walletSession: {
          type: "apiKey",
          in: "cookie",
          name: "__session",
          description:
            "Verified SIWE HTTP-only cookie. Local development uses hoplane_session.",
        },
        csrfToken: {
          type: "apiKey",
          in: "header",
          name: "X-CSRF-Token",
          description:
            "CSRF token from the authenticated session; not a provider API key.",
        },
      },
    },
  };
}
