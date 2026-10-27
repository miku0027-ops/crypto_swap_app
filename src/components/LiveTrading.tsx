import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  History,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { Modal } from "./Primitives";
import {
  api,
  authorizeTransfer,
  assertWalletAccount,
  BackendError,
  clearBroadcast,
  fromBaseUnits,
  isEvmAddress,
  isTransferSettled,
  messageHex,
  pendingBroadcasts,
  safeExplorerUrl,
  saveBroadcast,
  short,
  storageWritable,
  submitPreparedTransaction,
  toBaseUnits,
  uncertainBroadcasts,
  markUncertain,
  clearUncertain,
  isTxHash,
  requireSuccessfulReceipt,
} from "../lib/backend";
import type {
  BackendConfig,
  BalanceResult,
  LiveChain,
  LiveCurrency,
  LiveQuote,
  Network,
  PendingBroadcast,
  Preferences,
  Session,
  Transfer,
  UncertainBroadcast,
} from "../lib/backend";
import "./live.css";
const explain = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const DEFAULT_PREFS: Preferences = {
  version: 0,
  settings: {
    theme: "light",
    slippageBps: 50,
    gasTopup: false,
    network: "testnet",
  },
  favorites: [],
};
function initialPreferences(): Preferences {
  try {
    const theme = localStorage.getItem("hoplane.theme");
    if (theme === "light" || theme === "dark")
      return {
        ...DEFAULT_PREFS,
        settings: { ...DEFAULT_PREFS.settings, theme },
      };
  } catch {
    /* Restricted browser storage does not prevent viewing the app. */
  }
  return DEFAULT_PREFS;
}
const terminal = (transfer: Transfer) =>
  isTransferSettled(transfer) || transfer.status === "refund";
const currencyLabel = (c: LiveCurrency) =>
  `${c.symbol} · ${c.address === "0x0000000000000000000000000000000000000000" ? "Native" : short(c.address)}`;
const getStep = (t: Transfer) =>
  (t as Transfer & { submittedSteps?: Record<string, string> })
    .submittedSteps ?? {};
function CurrencyMark({ currency }: { currency: LiveCurrency }) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const logo = currency.metadata?.logoURI;
  const nativeEther =
    currency.symbol === "ETH" &&
    currency.address === "0x0000000000000000000000000000000000000000";
  return (
    <span
      className={`live-currency-mark ${nativeEther ? "native-ether" : ""}`}
      aria-hidden="true"
    >
      {logo && logo.startsWith("https://") && failedLogo !== logo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedLogo(logo)}
        />
      ) : nativeEther ? (
        <svg viewBox="0 0 24 32" width="18" height="25" aria-hidden="true">
          <path d="M12 0 0 17l12 7 12-7z" fill="white" />
          <path d="M12 0v24l12-7z" fill="#cdd5f6" />
          <path d="m0 20 12 12 12-12-12 7z" fill="white" />
        </svg>
      ) : (
        currency.symbol.slice(0, 2)
      )}
    </span>
  );
}
export default function LiveTrading({
  onDemo,
  view,
  onViewChange,
}: {
  onDemo: () => void;
  view?: "trade" | "account" | "activity";
  onViewChange?: (view: "trade" | "account" | "activity") => void;
}) {
  const [config, setConfig] = useState<BackendConfig | null>(null),
    [bootError, setBootError] = useState(""),
    [reload, setReload] = useState(0),
    [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null),
    [prefs, setPrefs] = useState<Preferences>(initialPreferences),
    [network, setNetwork] = useState<Network>("testnet");
  const [chains, setChains] = useState<LiveChain[]>([]),
    [chainsLoading, setChainsLoading] = useState(false),
    [fromChain, setFromChain] = useState(0),
    [toChain, setToChain] = useState(0),
    [from, setFrom] = useState<LiveCurrency | null>(null),
    [to, setTo] = useState<LiveCurrency | null>(null);
  const [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [customRecipient, setCustomRecipient] = useState(false),
    [slippage, setSlippage] = useState("0.5"),
    [gasTopup, setGasTopup] = useState(false);
  const [quote, setQuote] = useState<LiveQuote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [tab, setTab] = useState<"trade" | "account" | "activity">("trade");
  const [picker, setPicker] = useState<"from" | "to" | null>(null),
    [review, setReview] = useState(false),
    [transfer, setTransfer] = useState<Transfer | null>(null),
    [transactions, setTransactions] = useState<Transfer[]>([]),
    [pending, setPending] = useState<PendingBroadcast[]>([]),
    [executing, setExecuting] = useState(false),
    [trackingError, setTrackingError] = useState(""),
    [clock, setClock] = useState(Date.now()),
    [balance, setBalance] = useState<BalanceResult | null>(null),
    [balanceLoading, setBalanceLoading] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false),
    [uncertain, setUncertain] = useState<UncertainBroadcast[]>([]),
    [recoveryHash, setRecoveryHash] = useState<Record<string, string>>({}),
    [confirmedPriorHash, setConfirmedPriorHash] = useState(""),
    [receiptBusy, setReceiptBusy] = useState(false),
    [planInvalidated, setPlanInvalidated] = useState(true);
  const [historySearch, setHistorySearch] = useState(""),
    [historySource, setHistorySource] = useState("all"),
    [historyDestination, setHistoryDestination] = useState("all"),
    [historyStatus, setHistoryStatus] = useState("all");
  const selectedTheme = useRef<"light" | "dark" | null>(null);
  const currentAccount = useRef(""),
    mounted = useRef(true),
    requestRef = useRef<AbortController | null>(null),
    keyRef = useRef(""),
    executionLock = useRef(false),
    prepareKey = useRef(""),
    sessionRef = useRef<Session | null>(null),
    prefVersion = useRef(0),
    preparedSnapshot = useRef(""),
    preparedId = useRef(""),
    balanceKeyRef = useRef("");
  const balanceKey = JSON.stringify([
    network,
    fromChain,
    from?.address,
    session?.user.address,
  ]);
  const formKey = JSON.stringify({
    network,
    fromChain,
    toChain,
    from: from?.address,
    to: to?.address,
    amount,
    recipient,
    customRecipient,
    slippage,
    gasTopup,
    account: session?.user.address,
  });
  useEffect(() => {
    if (view) setTab(view);
  }, [view]);
  const navigateView = (next: "trade" | "account" | "activity") => {
    setTab(next);
    onViewChange?.(next);
  };
  useEffect(() => {
    balanceKeyRef.current = balanceKey;
    setBalance(null);
  }, [balanceKey]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.settings.theme;
    try {
      localStorage.setItem("hoplane.theme", prefs.settings.theme);
    } catch {
      /* Theme remains available in memory. */
    }
  }, [prefs.settings.theme]);
  useEffect(() => {
    const changeTheme = (event: Event) => {
      const theme = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      if (theme !== "light" && theme !== "dark") return;
      selectedTheme.current = theme;
      setPrefs((current) => ({
        ...current,
        settings: { ...current.settings, theme },
      }));
    };
    window.addEventListener("hoplane:theme-change", changeTheme);
    return () =>
      window.removeEventListener("hoplane:theme-change", changeTheme);
  }, []);
  useEffect(() => {
    keyRef.current = formKey;
    requestRef.current?.abort();
    setPlanInvalidated(true);
    setQuoteBusy(false);
    setQuote(null);
    setReview(false);
    prepareKey.current = "";
  }, [formKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    sessionRef.current = session;
    currentAccount.current = session?.user.address.toLowerCase() || "";
    setPending(session ? pendingBroadcasts(session.user.address) : []);
    setUncertain(session ? uncertainBroadcasts(session.user.address) : []);
    setTransfer(null);
    setTransactions([]);
    setHistorySearch("");
    setHistorySource("all");
    setHistoryDestination("all");
    setHistoryStatus("all");
  }, [session]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const notify = (text: string) => {
    setMessage(text);
    setError("");
  };
  const fail = (err: unknown) => {
    setError(explain(err));
    if (err instanceof BackendError && err.status === 401) {
      setSession(null);
      setQuote(null);
    }
  };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBooting(true);
    setBootError("");
    Promise.all([
      api<BackendConfig>("/config", { signal: controller.signal }),
      api<Session | { user: null }>("/auth/session", {
        signal: controller.signal,
      }),
    ])
      .then(([next, auth]) => {
        if (!active) return;
        if (
          !next?.capabilities ||
          !Array.isArray(next.networks?.testnet) ||
          !Array.isArray(next.networks?.mainnet)
        )
          throw new Error("The backend configuration is invalid.");
        setConfig(next);
        if (auth.user) setSession(auth as Session);
        else setSession(null);
        setBooting(false);
      })
      .catch((err) => {
        if (active) {
          setBootError(explain(err));
          setBooting(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reload]);
  useEffect(() => {
    const handleAccountChange = (accounts: string[]) => {
      const active = sessionRef.current;
      if (
        active &&
        (!accounts[0] ||
          accounts[0].toLowerCase() !== active.user.address.toLowerCase())
      ) {
        requestRef.current?.abort();
        setQuote(null);
        setSession(null);
        setReview(false);
        setError(
          "Your wallet account changed. Sign in again to use the new account.",
        );
        void api("/auth/logout", {
          method: "POST",
          body: {},
          csrfToken: active.csrfToken,
        }).catch(() => {});
      }
    };
    const handleChainChange = () => {
      requestRef.current?.abort();
      setQuote(null);
      setReview(false);
      setConfirmedPriorHash("");
      if (!executionLock.current) {
        setPlanInvalidated(true);
        setMessage(
          "Wallet network changed. Review a fresh quote before continuing.",
        );
      }
    };
    window.ethereum?.on?.("accountsChanged", handleAccountChange);
    window.ethereum?.on?.("chainChanged", handleChainChange);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountChange);
      window.ethereum?.removeListener?.("chainChanged", handleChainChange);
    };
  }, []);
  useEffect(() => {
    if (!config) return;
    let active = true;
    const controller = new AbortController();
    setChainsLoading(true);
    setChains([]);
    setFrom(null);
    setTo(null);
    api<{ chains: LiveChain[] }>(`/chains?network=${network}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!active) return;
        const allowed = config.networks[network];
        const rows = result.chains.filter(
          (c) =>
            allowed.includes(c.id) &&
            c.vmType === "evm" &&
            c.currency &&
            isEvmAddress(c.currency.address),
        );
        setChains(rows);
        setFromChain(rows[0]?.id || 0);
        setToChain(rows[1]?.id || rows[0]?.id || 0);
        setFrom(rows[0]?.currency || null);
        setTo((rows[1] || rows[0])?.currency || null);
        if (!rows.length)
          setError(
            "No supported EVM networks are configured for this environment.",
          );
        else setError("");
      })
      .catch((err) => {
        if (active) fail(err);
      })
      .finally(() => {
        if (active) setChainsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, network]);
  useEffect(() => {
    if (!session || !config?.capabilities.sync) return;
    let active = true;
    api<Preferences>("/preferences")
      .then((p) => {
        if (!active) return;
        setPrefs(
          selectedTheme.current
            ? {
                ...p,
                settings: { ...p.settings, theme: selectedTheme.current },
              }
            : p,
        );
        prefVersion.current = p.version;
        setSlippage(String(p.settings.slippageBps / 100));
        setGasTopup(p.settings.gasTopup);
        if (config.networks[p.settings.network]?.length)
          setNetwork(p.settings.network);
      })
      .catch((err) => {
        if (active) fail(err);
      });
    return () => {
      active = false;
    };
  }, [session?.user.address, config?.capabilities.sync]);
  const loadHistory = useCallback(async () => {
    const account = sessionRef.current?.user.address;
    if (!account) return;
    setHistoryBusy(true);
    try {
      const result = await api<{ transfers: Transfer[] }>("/transfers");
      if (mounted.current && sessionRef.current?.user.address === account)
        setTransactions(result.transfers);
    } catch (err) {
      if (mounted.current) fail(err);
    } finally {
      if (mounted.current) setHistoryBusy(false);
    }
  }, []);
  useEffect(() => {
    if (tab === "activity" && session) void loadHistory();
  }, [tab, session, loadHistory]);
  useEffect(() => {
    if (!transfer || terminal(transfer) || !session) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await api<Transfer>(
          `/transfers/${encodeURIComponent(transfer.id)}`,
        );
        if (!active) return;
        setTransfer(next);
        failures = 0;
        setTrackingError("");
        if (terminal(next)) {
          void loadHistory();
          return;
        }
      } catch (err) {
        if (!active) return;
        failures++;
        setTrackingError(
          `Tracking is temporarily unavailable: ${explain(err)} Your transfer is not being resubmitted.`,
        );
      }
      if (active)
        timer = setTimeout(poll, Math.min(3000 * 2 ** failures, 30000));
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    transfer?.id,
    session?.user.address,
    loadHistory,
    terminal(transfer || ({ status: "prepared" } as Transfer)),
  ]);
  const sourceId = (item: Transfer) =>
    item.summary?.currencyIn.chainId ?? item.transactions[0]?.chainId;
  const destinationId = (item: Transfer) => item.summary?.currencyOut.chainId;
  const chainLabel = (id: number | undefined) => {
    const known = chains.find((chain) => chain.id === id);
    return (
      known?.displayName ||
      known?.name ||
      (id ? `Chain ${id}` : "Network unavailable")
    );
  };
  const historyChainIds = [
    ...new Set([
      ...chains.map((chain) => chain.id),
      ...transactions
        .flatMap((item) => [sourceId(item), destinationId(item)])
        .filter((id): id is number => typeof id === "number"),
    ]),
  ].sort((a, b) => chainLabel(a).localeCompare(chainLabel(b)));
  const statusLabel = (item: Transfer) =>
    isTransferSettled(item)
      ? "Completed · provider reported"
      : item.status === "success"
        ? "Provider success · awaiting hash"
        : item.status === "prepared"
          ? "Prepared · not submitted"
          : item.status === "submitted"
            ? "Source submitted"
            : `Provider: ${item.status}`;
  const historyStatuses = [
    ...new Set(transactions.map((item) => item.status)),
  ].sort();
  const searchTerm = historySearch.trim().toLowerCase();
  const filteredTransactions = transactions.filter((item) => {
    if (historySource !== "all" && String(sourceId(item)) !== historySource)
      return false;
    if (
      historyDestination !== "all" &&
      String(destinationId(item)) !== historyDestination
    )
      return false;
    if (historyStatus !== "all" && item.status !== historyStatus) return false;
    const providerReference =
      "relayRequestId" in item && typeof item.relayRequestId === "string"
        ? item.relayRequestId
        : "";
    return (
      !searchTerm ||
      [
        item.id,
        item.quoteId,
        providerReference,
        item.network,
        item.summary?.currencyIn.symbol,
        item.summary?.currencyIn.name,
        item.summary?.currencyIn.address,
        item.summary?.currencyOut.symbol,
        item.summary?.currencyOut.name,
        item.summary?.currencyOut.address,
        ...item.transactions.flatMap((tx) => [tx.from, tx.to]),
        ...(item.txHashes || []),
        ...(item.inTxHashes || []),
        ...(item.verifiedTxHashes || []),
        ...(item.reportedTxHashes || []),
      ].some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(searchTerm),
      )
    );
  });
  const historyFiltersActive =
    !!searchTerm ||
    historySource !== "all" ||
    historyDestination !== "all" ||
    historyStatus !== "all";
  const clearHistoryFilters = () => {
    setHistorySearch("");
    setHistorySource("all");
    setHistoryDestination("all");
    setHistoryStatus("all");
  };
  const sourceChain = chains.find((c) => c.id === fromChain),
    destChain = chains.find((c) => c.id === toChain);
  const remaining = quote
    ? Math.max(0, Math.ceil((quote.expiresAt - clock) / 1000))
    : 0;
  let invalid = "";
  let rawAmount = "";
  try {
    if (amount && from) rawAmount = toBaseUnits(amount, from.decimals);
  } catch (err) {
    invalid = explain(err);
  }
  if (
    from &&
    to &&
    fromChain === toChain &&
    from.address.toLowerCase() === to.address.toLowerCase()
  )
    invalid = "Choose a different token or destination network.";
  if (customRecipient && !isEvmAddress(recipient))
    invalid = "Enter a valid EVM recipient address.";
  const slippageBps = Math.round(Number(slippage) * 100);
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(slippage) ||
    !Number.isFinite(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > (config?.maxSlippageBps ?? 300)
  )
    invalid = `Slippage must be between 0 and ${(config?.maxSlippageBps ?? 300) / 100}%.`;
  async function connect() {
    const provider = window.ethereum;
    if (!provider) {
      fail(
        new Error(
          "Install an EVM wallet such as MetaMask or Rabby, then reload.",
        ),
      );
      return;
    }
    setAuthBusy(true);
    setError("");
    try {
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      if (!Array.isArray(accounts) || !isEvmAddress(accounts[0]))
        throw new Error("No valid wallet account was selected.");
      const address = accounts[0];
      const challenge = await api<{
        challengeId: string;
        message: string;
        expiresAt: number;
      }>("/auth/challenge", {
        body: { address, chainId: config!.authChainId },
      });
      await assertWalletAccount(provider, address);
      const signature = await provider.request({
        method: "personal_sign",
        params: [messageHex(challenge.message), address],
      });
      if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature))
        throw new Error("The wallet returned an invalid sign-in signature.");
      await assertWalletAccount(provider, address);
      const auth = await api<Session>("/auth/verify", {
        body: { challengeId: challenge.challengeId, signature },
      });
      if (auth.user.address.toLowerCase() !== address.toLowerCase())
        throw new Error(
          "The authenticated account does not match your wallet.",
        );
      setSession(auth);
      notify("Wallet ownership verified. You’re signed in.");
    } catch (err) {
      fail(err);
    } finally {
      setAuthBusy(false);
    }
  }
  async function disconnect() {
    if (!session) return;
    setAuthBusy(true);
    try {
      await api("/auth/logout", {
        method: "POST",
        body: {},
        csrfToken: session.csrfToken,
      });
      setSession(null);
      setTransfer(null);
      setBalance(null);
      setTransactions([]);
      notify("Signed out. Your wallet remains under your control.");
    } catch (err) {
      fail(err);
    } finally {
      setAuthBusy(false);
    }
  }
  async function getQuote() {
    if (!session || !from || !to || !rawAmount || invalid) return;
    setQuoteBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const snapshot = formKey;
    try {
      if (!window.ethereum)
        throw new Error("Your wallet is unavailable. Reload and reconnect.");
      await assertWalletAccount(window.ethereum, session.user.address);
      const next = await api<LiveQuote>("/quotes", {
        body: {
          network,
          quote: {
            user: session.user.address,
            originChainId: fromChain,
            destinationChainId: toChain,
            originCurrency: from.address,
            destinationCurrency: to.address,
            amount: rawAmount,
            tradeType: "EXACT_INPUT",
            recipient: customRecipient ? recipient : session.user.address,
            slippageTolerance: String(slippageBps),
            topupGas: gasTopup,
          },
        },
        csrfToken: session.csrfToken,
        signal: controller.signal,
        timeoutMs: 20000,
      });
      if (controller.signal.aborted || keyRef.current !== snapshot) return;
      if (
        !next.id ||
        !next.summary ||
        !Number.isFinite(next.expiresAt) ||
        next.expiresAt <= Date.now()
      )
        throw new Error(
          "The provider returned an expired or incomplete quote. Please retry.",
        );
      setQuote(next);
      prepareKey.current = crypto.randomUUID();
      setReview(true);
    } catch (err) {
      if (!controller.signal.aborted) fail(err);
    } finally {
      if (requestRef.current === controller) setQuoteBusy(false);
    }
  }
  async function trackBroadcast(record: PendingBroadcast, automatic = false) {
    const auth = sessionRef.current;
    if (
      !auth ||
      record.address.toLowerCase() !== auth.user.address.toLowerCase()
    )
      throw new Error(
        "Sign in with the sending wallet to recover this transfer.",
      );
    const attempts = automatic ? 3 : 1;
    for (let i = 0; i < attempts; i++) {
      try {
        const next = await api<Transfer>(
          `/transfers/${encodeURIComponent(record.transferId)}/transactions`,
          {
            body: { transactionHash: record.hash, stepIndex: record.stepIndex },
            csrfToken: auth.csrfToken,
          },
        );
        if (
          sessionRef.current?.user.address.toLowerCase() !==
          auth.user.address.toLowerCase()
        )
          throw new Error(
            "Sign in with the sending wallet to continue tracking this transfer.",
          );
        clearBroadcast(record.transferId, record.stepIndex);
        clearUncertain(record.transferId, record.stepIndex);
        setUncertain(uncertainBroadcasts(auth.user.address));
        setPending(pendingBroadcasts(auth.user.address));
        setTransfer(next);
        notify("Transaction submitted. Tracking confirmation across networks.");
        return;
      } catch (err) {
        if (
          err instanceof BackendError &&
          err.code === "TRANSACTION_NOT_FOUND" &&
          i < attempts - 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
  }
  async function execute(stepIndex = 0) {
    if (executionLock.current || !session || !window.ethereum) return;
    executionLock.current = true;
    setExecuting(true);
    setError("");
    setMessage("");
    try {
      if (!storageWritable())
        throw new Error(
          "Allow browser storage before sending so a submitted transaction can be recovered safely.",
        );
      let current = transfer;
      if (!current || (!review && current.transactions.length === 0)) {
        throw new Error("Review a current quote before continuing.");
      }
      const existing = pendingBroadcasts(session.user.address).find(
        (p) => p.transferId === current!.id && p.stepIndex === stepIndex,
      );
      if (existing) {
        await trackBroadcast(existing, true);
        return;
      }
      if (uncertainBroadcasts(session.user.address).length)
        throw new Error(
          "Resolve the uncertain wallet submission before signing another transaction.",
        );
      if (getStep(current)[String(stepIndex)])
        throw new Error(
          "This transaction step was already submitted. Refresh tracking instead of sending it again.",
        );
      const tx = current.transactions[stepIndex];
      if (!tx) throw new Error("No transaction is available for this step.");
      if (
        preparedSnapshot.current !== keyRef.current ||
        preparedId.current !== current.id ||
        planInvalidated
      )
        throw new Error(
          "Your route or wallet network changed. Review a fresh quote before signing.",
        );
      if (currentAccount.current !== session.user.address.toLowerCase())
        throw new Error("The wallet account changed. Sign in again.");
      let hash: string;
      try {
        hash = await submitPreparedTransaction(
          window.ethereum,
          tx,
          session.user.address,
          current.expiresAt,
          Date.now,
          {
            authorize: () =>
              authorizeTransfer(current!.id, stepIndex, session.csrfToken, tx),
            previousHash:
              stepIndex > 0
                ? getStep(current)[String(stepIndex - 1)]
                : undefined,
            beforeBroadcast: () => {
              if (
                !mounted.current ||
                preparedSnapshot.current !== keyRef.current ||
                preparedId.current !== current!.id ||
                currentAccount.current !== session.user.address.toLowerCase()
              )
                throw new Error(
                  "The trading view, route, or account changed before signing. Request a fresh quote.",
                );
              markUncertain({
                transferId: current!.id,
                stepIndex,
                address: session.user.address,
                createdAt: Date.now(),
              });
              setUncertain(uncertainBroadcasts(session.user.address));
            },
          },
        );
      } catch (err) {
        if (err instanceof BackendError && err.code === "USER_REJECTED") {
          clearUncertain(current.id, stepIndex);
          setUncertain(uncertainBroadcasts(session.user.address));
          setPlanInvalidated(true);
        }
        throw err;
      }
      const record: PendingBroadcast = {
        transferId: current.id,
        stepIndex,
        hash,
        address: session.user.address,
        createdAt: Date.now(),
      };
      try {
        saveBroadcast(record);
        clearUncertain(current.id, stepIndex);
        setUncertain(uncertainBroadcasts(session.user.address));
      } catch {
        setPending((prev) => [record, ...prev]);
        throw new Error(
          `Transaction ${hash} was sent, but recovery storage is unavailable. Save this hash and use activity tracking. Do not send it again.`,
        );
      }
      setPending(pendingBroadcasts(session.user.address));
      setReview(false);
      try {
        await trackBroadcast(record, true);
      } catch (err) {
        setTrackingError(
          `Transaction ${hash} was sent. ${explain(err)} Use “Retry tracking”; do not send it again.`,
        );
      }
    } catch (err) {
      if (err instanceof BackendError && err.code === "STEP_ALREADY_AUTHORIZED")
        setPlanInvalidated(true);
      fail(err);
    } finally {
      executionLock.current = false;
      setExecuting(false);
    }
  }
  async function confirmQuote() {
    if (
      !quote ||
      !session ||
      !quote.executable ||
      remaining <= 0 ||
      executionLock.current ||
      uncertain.length ||
      pending.length
    )
      return;
    executionLock.current = true;
    setExecuting(true);
    setError("");
    try {
      const prepared = await api<Transfer>(
        `/quotes/${encodeURIComponent(quote.id)}/prepare`,
        {
          body: {},
          csrfToken: session.csrfToken,
          idempotencyKey: prepareKey.current,
        },
      );
      setTransfer(prepared);
      preparedSnapshot.current = formKey;
      preparedId.current = prepared.id;
      setPlanInvalidated(false);
      setReview(false);
      notify(
        "Route prepared. Review the transaction details below, then confirm the first step in your wallet.",
      );
    } catch (err) {
      fail(err);
    } finally {
      executionLock.current = false;
      setExecuting(false);
    }
  }
  async function refreshBalance() {
    if (!session || !from || !config?.capabilities.balances) return;
    setBalanceLoading(true);
    setError("");
    const snapshot = balanceKey;
    try {
      const result = await api<BalanceResult>("/balances", {
        body: { network, chainId: fromChain, currencies: [from.address] },
        csrfToken: session.csrfToken,
      });
      if (snapshot === balanceKeyRef.current) setBalance(result);
    } catch (err) {
      fail(err);
    } finally {
      setBalanceLoading(false);
    }
  }
  async function savePreferences() {
    if (!session) return;
    setSaving(true);
    setError("");
    const next: Preferences = {
      version: prefVersion.current,
      settings: { ...prefs.settings, slippageBps, gasTopup, network },
      favorites: prefs.favorites,
    };
    try {
      const saved = await api<Preferences>("/preferences", {
        method: "PUT",
        body: next,
        csrfToken: session.csrfToken,
      });
      setPrefs(saved);
      prefVersion.current = saved.version;
      setSettingsOpen(false);
      notify("Preferences synced to your account.");
    } catch (err) {
      if (err instanceof BackendError && err.status === 409) {
        try {
          const latest = await api<Preferences>("/preferences");
          setPrefs(latest);
          prefVersion.current = latest.version;
          setSlippage(String(latest.settings.slippageBps / 100));
          setGasTopup(latest.settings.gasTopup);
          setNetwork(latest.settings.network);
          setError(
            "Preferences changed on another device. The latest settings were loaded; review before saving again.",
          );
        } catch (inner) {
          fail(inner);
        }
      } else fail(err);
    } finally {
      setSaving(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Copied to clipboard");
    } catch {
      fail(
        new Error(
          "Clipboard access is unavailable. Select and copy the displayed address.",
        ),
      );
    }
  }
  const closePicker = useCallback(() => setPicker(null), []),
    closeSettings = useCallback(() => setSettingsOpen(false), []),
    closeReview = useCallback(() => {
      if (!executionLock.current) setReview(false);
    }, []);
  async function checkPrior() {
    if (!transfer || !session || !window.ethereum || nextStep < 1) return;
    setReceiptBusy(true);
    try {
      const tx = transfer.transactions[nextStep];
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      if (chain !== `0x${tx.chainId.toString(16)}`)
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${tx.chainId.toString(16)}` }],
        });
      await assertWalletAccount(window.ethereum, session.user.address);
      const hash = getStep(transfer)[String(nextStep - 1)];
      await requireSuccessfulReceipt(window.ethereum, hash, tx.chainId);
      setConfirmedPriorHash(hash);
      notify("Previous transaction confirmed. You can review the next step.");
    } catch (err) {
      fail(err);
    } finally {
      setReceiptBusy(false);
    }
  }
  const expiredTransfer = !!transfer && clock >= transfer.expiresAt;
  const nextStep = transfer
    ? transfer.transactions.findIndex((_, i) => !getStep(transfer)[String(i)])
    : -1;
  const waitingBroadcast = transfer
    ? pending.find((p) => p.transferId === transfer.id)
    : undefined;
  if (booting || bootError || !config)
    return (
      <section
        className="live-shell live-availability-shell"
        aria-label="Live swap availability"
      >
        <div className="live-connection-card">
          <div className="live-availability-heading">
            <h1>Swap & bridge</h1>
            <span className="live-availability-badge">
              <span />
              {booting ? "Connecting" : "Live unavailable"}
            </span>
          </div>
          <div className="live-offline-route" aria-hidden="true">
            <div>
              <span>From</span>
              <strong>Choose a token</strong>
              <small>Source network</small>
            </div>
            <span className="live-offline-arrow">
              <ArrowDown size={19} />
            </span>
            <div>
              <span>To</span>
              <strong>Your next destination</strong>
              <small>Destination network</small>
            </div>
          </div>
          <div
            className="live-availability-message"
            role={booting ? "status" : undefined}
          >
            <span className="live-status-icon">
              {booting ? (
                <Loader2 className="spin" size={22} />
              ) : (
                <Info size={22} />
              )}
            </span>
            <div>
              <h2>
                {booting
                  ? "Connecting to Hoplane"
                  : "Live trading is unavailable."}
              </h2>
              <p>
                {booting
                  ? "Checking live service availability."
                  : "Live services aren’t available right now. Retry the connection or explore the demo with sample data."}
              </p>
            </div>
          </div>
          {!booting && (
            <>
              <div className="live-inline-actions">
                <button className="primary-button" onClick={onDemo}>
                  Explore the demo
                  <ArrowRight size={17} />
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setReload((v) => v + 1)}
                >
                  <RefreshCw size={16} />
                  Retry connection
                </button>
              </div>
              <p className="live-availability-caption">
                <ShieldCheck size={15} />
                Demo uses sample data. No real funds move.
              </p>
            </>
          )}
        </div>
      </section>
    );
  return (
    <section className="live-shell">
      <div className="live-topbar">
        <div>
          <span className="eyebrow">YOUR NEXT MOVE, VERIFIED</span>
          <h1>Move with confidence.</h1>
          <p>Fresh quotes. Your wallet. A clear view of every step.</p>
        </div>
        <div
          className={`live-network-pill ${network === "mainnet" ? "real-funds" : ""}`}
        >
          <span />
          {network === "mainnet"
            ? "Mainnet · real funds"
            : "Testnet · test tokens"}
        </div>
      </div>
      <div className="live-workspace">
        <div className="live-main">
          <div
            className="live-tabbar"
            role="tablist"
            aria-label="Live workspace"
          >
            {(["trade", "account", "activity"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                id={`live-workspace-tab-${t}`}
                aria-controls="live-workspace-panel"
                tabIndex={tab === t ? 0 : -1}
                aria-selected={tab === t}
                onKeyDown={(event) => {
                  const tabs = ["trade", "account", "activity"] as const;
                  const index = tabs.indexOf(t);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  navigateView(tabs[next]);
                  document
                    .getElementById(`live-workspace-tab-${tabs[next]}`)
                    ?.focus();
                }}
                className={tab === t ? "active" : ""}
                onClick={() => navigateView(t)}
              >
                {t === "trade"
                  ? "Swap & bridge"
                  : t === "account"
                    ? "My account"
                    : "Activity"}
              </button>
            ))}
            <button
              aria-label="Live preferences"
              className="icon-button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={18} />
            </button>
          </div>
          <div
            id="live-workspace-panel"
            role="tabpanel"
            aria-labelledby={`live-workspace-tab-${tab}`}
          >
            {error && (
              <div className="live-error" role="alert">
                <Info size={17} />
                <span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={15} />
                </button>
              </div>
            )}
            {message && (
              <div className="live-message" role="status">
                <Check size={16} />
                <span>{message}</span>
              </div>
            )}
            {tab === "trade" ? (
              <>
                <div className="live-form-heading">
                  <div>
                    <h2>Where to next?</h2>
                    <p>Choose the assets and networks for your move.</p>
                  </div>
                  <select
                    aria-label="Live network environment"
                    value={network}
                    onChange={(e) => setNetwork(e.target.value as Network)}
                    disabled={executing}
                  >
                    <option value="testnet">Testnet</option>
                    <option
                      value="mainnet"
                      disabled={!config.networks.mainnet.length}
                    >
                      Mainnet
                    </option>
                  </select>
                </div>
                {!config.capabilities.quotes && (
                  <div className="live-setup-note">
                    <Info size={17} />
                    <span>
                      Live quotes aren’t available in this environment yet. You
                      can still sign in and use available account services.
                    </span>
                  </div>
                )}
                {chainsLoading ? (
                  <div className="live-loading" role="status">
                    <Loader2 className="spin" size={22} />
                    Loading supported networks…
                  </div>
                ) : (
                  <>
                    <div className="live-amount-panel">
                      <div className="live-amount-head">
                        <label htmlFor="live-amount">You pay</label>
                        <select
                          aria-label="Source network"
                          value={fromChain}
                          disabled={executing || !chains.length}
                          onChange={(e) => {
                            const id = Number(e.target.value);
                            setFromChain(id);
                            setFrom(
                              chains.find((c) => c.id === id)?.currency || null,
                            );
                            setBalance(null);
                          }}
                        >
                          {!chains.length && (
                            <option value={0}>No networks configured</option>
                          )}
                          {chains.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.displayName || c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="live-amount-line">
                        <input
                          id="live-amount"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0.00"
                          value={amount}
                          disabled={executing}
                          onChange={(e) => {
                            if (
                              /^\d*\.?\d*$/.test(e.target.value) &&
                              e.target.value.length <= 90
                            )
                              setAmount(e.target.value);
                          }}
                        />
                        <button
                          className="live-token-button"
                          aria-label="Select live source token"
                          disabled={!sourceChain || executing}
                          onClick={() => setPicker("from")}
                        >
                          {from ? (
                            <>
                              <CurrencyMark currency={from} />
                              <strong>{from.symbol}</strong>
                            </>
                          ) : (
                            "Select token"
                          )}
                          <ChevronDown size={15} />
                        </button>
                      </div>
                      <div className="live-amount-foot">
                        <span>
                          {from
                            ? currencyLabel(from)
                            : "Authoritative network catalog"}
                        </span>
                        <span>Exact input</span>
                      </div>
                    </div>
                    <button
                      className="live-reverse"
                      aria-label="Reverse live route"
                      disabled={!from || !to || executing}
                      onClick={() => {
                        setFrom(to);
                        setTo(from);
                        setFromChain(toChain);
                        setToChain(fromChain);
                        setBalance(null);
                      }}
                    >
                      <ArrowDown size={17} />
                    </button>
                    <div className="live-amount-panel live-destination">
                      <div className="live-amount-head">
                        <span>You receive</span>
                        <select
                          aria-label="Destination network"
                          value={toChain}
                          disabled={executing || !chains.length}
                          onChange={(e) => {
                            const id = Number(e.target.value);
                            setToChain(id);
                            setTo(
                              chains.find((c) => c.id === id)?.currency || null,
                            );
                          }}
                        >
                          {!chains.length && (
                            <option value={0}>No networks configured</option>
                          )}
                          {chains.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.displayName || c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="live-amount-line">
                        <strong className="live-estimate">
                          {quote
                            ? fromBaseUnits(
                                quote.summary.amountOut,
                                quote.summary.currencyOut.decimals,
                              )
                            : "—"}
                        </strong>
                        <button
                          className="live-token-button"
                          aria-label="Select live destination token"
                          disabled={!destChain || executing}
                          onClick={() => setPicker("to")}
                        >
                          {to ? (
                            <>
                              <CurrencyMark currency={to} />
                              <strong>{to.symbol}</strong>
                            </>
                          ) : (
                            "Select token"
                          )}
                          <ChevronDown size={15} />
                        </button>
                      </div>
                      <div className="live-amount-foot">
                        <span>
                          {to ? currencyLabel(to) : "Choose a destination"}
                        </span>
                        <span>
                          {quote ? "Live estimate" : "Quote required"}
                        </span>
                      </div>
                    </div>
                  </>
                )}
                <label className="live-checkbox">
                  <input
                    type="checkbox"
                    checked={customRecipient}
                    disabled={executing}
                    onChange={(e) => setCustomRecipient(e.target.checked)}
                  />
                  Send to another wallet
                </label>
                {customRecipient && (
                  <label className="live-field">
                    <span className="live-field-label">
                      Recipient address{" "}
                      <span>
                        {destChain?.displayName ||
                          destChain?.name ||
                          "Destination wallet"}
                      </span>
                    </span>
                    <input
                      aria-label="Live recipient address"
                      aria-invalid={
                        recipient.length > 0 && !isEvmAddress(recipient)
                      }
                      aria-describedby="live-recipient-hint"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="0x…"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value.trim())}
                      disabled={executing}
                    />
                    <small id="live-recipient-hint">
                      Enter the destination wallet’s complete 0x address.
                    </small>
                  </label>
                )}
                {amount && invalid && (
                  <p className="live-validation" role="alert">
                    {invalid}
                  </p>
                )}
                <div className="live-mini-row">
                  <button onClick={() => setSettingsOpen(true)}>
                    Slippage {slippage}%<Settings2 size={12} />
                  </button>
                  <span>
                    <ShieldCheck size={13} />
                    Non-custodial
                  </span>
                </div>
                {!session ? (
                  <button
                    className="primary-button"
                    disabled={authBusy}
                    onClick={connect}
                  >
                    {authBusy ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <Wallet size={17} />
                    )}
                    Connect & verify wallet
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    disabled={
                      quoteBusy ||
                      executing ||
                      !rawAmount ||
                      !!invalid ||
                      !from ||
                      !to ||
                      !config.capabilities.quotes
                    }
                    onClick={getQuote}
                  >
                    {quoteBusy ? (
                      <>
                        <Loader2 className="spin" size={17} />
                        Finding your route…
                      </>
                    ) : (
                      <>
                        Review live quote
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                )}
                <p className="live-hint">
                  {session
                    ? `Signed in as ${short(session.user.address)}`
                    : "Sign-in verifies wallet ownership. It does not approve a transfer."}
                </p>
              </>
            ) : tab === "account" ? (
              <div className="live-account">
                <h2>Your account, across devices.</h2>
                <p>
                  Verified wallet ownership protects your preferences and
                  transfer history.
                </p>
                {session ? (
                  <>
                    <div className="live-address">
                      <Wallet size={22} />
                      <span>{short(session.user.address)}</span>
                      <button
                        className="icon-button"
                        aria-label="Copy signed-in address"
                        onClick={() => copy(session.user.address)}
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                    <div className="live-account-actions">
                      <button
                        className="secondary-button"
                        onClick={() => setSettingsOpen(true)}
                      >
                        Synced preferences
                        <Settings2 size={15} />
                      </button>
                      <button
                        className="secondary-button"
                        disabled={authBusy}
                        onClick={disconnect}
                      >
                        Sign out
                        <LogOut size={15} />
                      </button>
                    </div>
                    <div className="live-section-heading">
                      <div>
                        <h3>Source asset balance</h3>
                        <small>
                          {sourceChain?.name || "Select a network"} ·{" "}
                          {from?.symbol || "Select a token"}
                        </small>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Refresh balance"
                        disabled={
                          !config.capabilities.balances ||
                          balanceLoading ||
                          !from
                        }
                        onClick={refreshBalance}
                      >
                        <RefreshCw
                          className={balanceLoading ? "spin" : ""}
                          size={17}
                        />
                      </button>
                    </div>
                    {!config.capabilities.balances ? (
                      <p className="live-hint left">
                        Balance reads will become available once trusted RPC
                        endpoints are configured.
                      </p>
                    ) : balance?.chainId === fromChain ? (
                      balance.assets.map((a) => (
                        <div className="live-balance" key={a.address}>
                          <strong>{a.symbol}</strong>
                          <span>
                            {a.error?.message || a.formatted || "Unavailable"}
                          </span>
                        </div>
                      ))
                    ) : (
                      <button
                        className="secondary-button"
                        disabled={!from || balanceLoading}
                        onClick={refreshBalance}
                      >
                        {balanceLoading
                          ? "Reading blockchain…"
                          : "Load current balance"}
                      </button>
                    )}
                    <p className="live-hint left">
                      This reads the selected source asset on chain. No
                      estimated fiat portfolio value is substituted.
                    </p>
                  </>
                ) : (
                  <button
                    className="primary-button"
                    disabled={authBusy}
                    onClick={connect}
                  >
                    {authBusy
                      ? "Waiting for wallet…"
                      : "Connect & verify wallet"}
                  </button>
                )}
              </div>
            ) : (
              <div className="live-activity">
                <div className="live-section-heading">
                  <div>
                    <h2>Every real move.</h2>
                    <p>Your latest 50 transfers · this wallet only.</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Refresh live activity"
                    disabled={!session || historyBusy}
                    onClick={loadHistory}
                  >
                    <RefreshCw
                      className={historyBusy ? "spin" : ""}
                      size={18}
                    />
                  </button>
                </div>
                {session && (
                  <div
                    className="live-history-filters"
                    aria-label="Filter your transfers"
                  >
                    <label className="live-history-search">
                      <Search size={17} aria-hidden="true" />
                      <input
                        type="search"
                        aria-label="Search your transfers"
                        placeholder="Token, address, transaction hash, or reference"
                        value={historySearch}
                        maxLength={160}
                        onChange={(event) =>
                          setHistorySearch(event.target.value)
                        }
                      />
                    </label>
                    <div className="live-history-filter-grid">
                      <label>
                        From network
                        <select
                          aria-label="Filter source network"
                          value={historySource}
                          onChange={(event) =>
                            setHistorySource(event.target.value)
                          }
                        >
                          <option value="all">All networks</option>
                          {historyChainIds.map((id) => (
                            <option key={id} value={id}>
                              {chainLabel(id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        To network
                        <select
                          aria-label="Filter destination network"
                          value={historyDestination}
                          onChange={(event) =>
                            setHistoryDestination(event.target.value)
                          }
                        >
                          <option value="all">All networks</option>
                          {historyChainIds.map((id) => (
                            <option key={id} value={id}>
                              {chainLabel(id)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Status
                        <select
                          aria-label="Filter transfer status"
                          value={historyStatus}
                          onChange={(event) =>
                            setHistoryStatus(event.target.value)
                          }
                        >
                          <option value="all">All statuses</option>
                          {historyStatuses.map((status) => (
                            <option key={status} value={status}>
                              {status === "success"
                                ? "Provider success"
                                : status[0]?.toUpperCase() + status.slice(1)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="live-history-filter-summary">
                      <span role="status">
                        {filteredTransactions.length} of {transactions.length}{" "}
                        transfers
                      </span>
                      <button
                        onClick={clearHistoryFilters}
                        disabled={!historyFiltersActive}
                      >
                        Clear filters
                      </button>
                    </div>
                  </div>
                )}
                {!session ? (
                  <div className="live-empty">
                    <History size={32} />
                    <h3>Sign in to see your transfers.</h3>
                    <button
                      className="secondary-button"
                      disabled={authBusy}
                      onClick={connect}
                    >
                      Connect & verify wallet
                    </button>
                  </div>
                ) : historyBusy && !transactions.length ? (
                  <div className="live-loading" role="status">
                    <Loader2 className="spin" size={21} />
                    Loading your transfers…
                  </div>
                ) : !transactions.length ? (
                  <div className="live-empty">
                    <History size={32} />
                    <h3>No live transfers yet.</h3>
                    <p>
                      Confirmed preparations and submitted routes appear here.
                    </p>
                  </div>
                ) : !filteredTransactions.length ? (
                  <div className="live-empty">
                    <Search size={30} />
                    <h3>No matching transfers.</h3>
                    <p>
                      Try another token, transaction hash, or network
                      combination.
                    </p>
                    <button
                      className="secondary-button"
                      onClick={clearHistoryFilters}
                    >
                      Show all transfers
                    </button>
                  </div>
                ) : (
                  filteredTransactions.map((t) => (
                    <button
                      className="live-history-row"
                      key={t.id}
                      onClick={() => {
                        setTransfer(t);
                        setPlanInvalidated(true);
                        preparedId.current = "";
                        navigateView("trade");
                      }}
                    >
                      <div>
                        <strong>
                          {t.summary
                            ? `${fromBaseUnits(t.summary.amountIn, t.summary.currencyIn.decimals)} ${t.summary.currencyIn.symbol}`
                            : "Transfer"}
                          {t.summary
                            ? ` → ${t.summary.currencyOut.symbol}`
                            : ""}
                        </strong>
                        <span className="live-history-route">
                          {chainLabel(sourceId(t))} <ArrowRight size={12} />{" "}
                          {chainLabel(destinationId(t))}
                        </span>
                        <small>
                          {t.createdAt
                            ? new Date(t.createdAt).toLocaleString()
                            : short(t.id)}
                        </small>
                      </div>
                      <span
                        className={
                          isTransferSettled(t)
                            ? "live-success-badge"
                            : "live-status-badge"
                        }
                      >
                        {statusLabel(t)}
                      </span>
                      <ChevronDown size={15} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <aside className="live-sidebar">
          <div className="live-security-card">
            <ShieldCheck size={25} />
            <h3>Clarity at every step.</h3>
            <p>
              Review the route, minimum received, and fees. You authorize
              transactions directly in your wallet.
            </p>
            <ul>
              <li>
                <Check size={14} />
                Check the assets, networks, and recipient
              </li>
              <li>
                <Check size={14} />
                Review the minimum you’ll receive
              </li>
              <li>
                <Check size={14} />
                Confirm directly in your wallet
              </li>
            </ul>
            <button onClick={onDemo}>
              Try the no-funds demo
              <ArrowRight size={14} />
            </button>
          </div>
          {uncertain.length > 0 && (
            <div className="live-recovery-card">
              <h3>Wallet submission needs reconciliation</h3>
              <p>
                A wallet request was started but its result is unknown. Further
                signing is paused. Check your wallet activity and enter the
                transaction hash below. Do not send the transaction again.
              </p>
              {uncertain.map((record) => (
                <div key={`${record.transferId}-${record.stepIndex}`}>
                  <code>
                    {record.transferId} · step {record.stepIndex + 1}
                  </code>
                  <label className="live-field">
                    Transaction hash
                    <input
                      aria-label={`Recover transaction ${record.stepIndex + 1}`}
                      placeholder="0x…"
                      value={recoveryHash[record.transferId] || ""}
                      onChange={(e) =>
                        setRecoveryHash((p) => ({
                          ...p,
                          [record.transferId]: e.target.value.trim(),
                        }))
                      }
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={
                      executing ||
                      !isTxHash(recoveryHash[record.transferId] || "")
                    }
                    onClick={async () => {
                      setExecuting(true);
                      try {
                        const candidate = {
                          ...record,
                          hash: recoveryHash[record.transferId],
                        };
                        saveBroadcast(candidate);
                        setPending(pendingBroadcasts(session?.user.address));
                        await trackBroadcast(candidate);
                      } catch (err) {
                        fail(err);
                      } finally {
                        setExecuting(false);
                      }
                    }}
                  >
                    Verify and track hash
                  </button>
                </div>
              ))}
            </div>
          )}
          {pending.length > 0 && (
            <div className="live-recovery-card">
              <h3>Keep tracking your transfer</h3>
              <p>
                A transaction was already broadcast. Retry tracking safely
                without sending it again.
              </p>
              {pending.map((record) => (
                <div key={`${record.transferId}-${record.stepIndex}`}>
                  <code>{record.hash}</code>
                  <button
                    className="secondary-button"
                    disabled={executing}
                    onClick={async () => {
                      setExecuting(true);
                      try {
                        await trackBroadcast(record);
                      } catch (err) {
                        fail(err);
                      } finally {
                        setExecuting(false);
                      }
                    }}
                  >
                    Retry tracking
                    <RefreshCw size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {transfer && (
            <div className="live-transfer-card">
              <div className="live-section-heading">
                <h3>
                  {isTransferSettled(transfer)
                    ? "Arrived at your destination."
                    : transfer.status === "refund"
                      ? "Transfer refunded."
                      : "Your transfer"}
                </h3>
                {terminal(transfer) ? (
                  <Check size={20} />
                ) : (
                  <Clock3 size={20} />
                )}
              </div>
              <span className="live-status-badge">
                {isTransferSettled(transfer)
                  ? "Completed"
                  : transfer.status === "success"
                    ? "Awaiting destination receipt"
                    : transfer.status}
              </span>
              <p>
                Reference: <code>{short(transfer.id)}</code>
              </p>
              {transfer.transactions.map((tx, i) => (
                <div className="live-tx-step" key={`${transfer.id}-${i}`}>
                  <span className={getStep(transfer)[String(i)] ? "done" : ""}>
                    {getStep(transfer)[String(i)] ? <Check size={13} /> : i + 1}
                  </span>
                  <div>
                    <strong>{tx.stepId || `Transaction ${i + 1}`}</strong>
                    <small>
                      Network {tx.chainId} · to {short(tx.to)}
                    </small>
                    <small>Value: {tx.value} base units</small>
                    <details>
                      <summary>Transaction data</summary>
                      <code>{tx.data}</code>
                    </details>
                  </div>
                </div>
              ))}
              {trackingError && (
                <p className="live-validation" role="alert">
                  {trackingError}
                </p>
              )}
              {!terminal(transfer) &&
                nextStep >= 0 &&
                session &&
                !uncertain.some(
                  (record) => record.transferId === transfer.id,
                ) && (
                  <details className="live-remote-recovery">
                    <summary>Track a transaction from another device</summary>
                    <p className="live-hint left">
                      If this step was already submitted, enter its wallet
                      transaction hash. This verifies and tracks the existing
                      transaction.
                    </p>
                    <label className="live-field">
                      Existing transaction hash
                      <input
                        aria-label="Existing transfer transaction hash"
                        placeholder="0x…"
                        value={recoveryHash[transfer.id] || ""}
                        onChange={(event) =>
                          setRecoveryHash((previous) => ({
                            ...previous,
                            [transfer.id]: event.target.value.trim(),
                          }))
                        }
                      />
                    </label>
                    <button
                      className="secondary-button"
                      disabled={
                        executing || !isTxHash(recoveryHash[transfer.id] || "")
                      }
                      onClick={async () => {
                        const record: PendingBroadcast = {
                          transferId: transfer.id,
                          stepIndex: nextStep,
                          hash: recoveryHash[transfer.id],
                          address: session.user.address,
                          createdAt: Date.now(),
                        };
                        setExecuting(true);
                        try {
                          await trackBroadcast(record);
                        } catch (err) {
                          if (
                            err instanceof BackendError &&
                            err.code === "TRANSACTION_NOT_FOUND"
                          ) {
                            try {
                              saveBroadcast(record);
                              setPending(
                                pendingBroadcasts(session.user.address),
                              );
                            } catch {
                              /* Keep the visible wallet hash for manual recovery. */
                            }
                          }
                          fail(err);
                        } finally {
                          setExecuting(false);
                        }
                      }}
                    >
                      Verify and track existing transfer
                    </button>
                  </details>
                )}
              {!terminal(transfer) && nextStep >= 0 && !waitingBroadcast && (
                <>
                  {nextStep > 0 &&
                    confirmedPriorHash !==
                      getStep(transfer)[String(nextStep - 1)] && (
                      <button
                        className="secondary-button"
                        disabled={receiptBusy || executing}
                        onClick={checkPrior}
                      >
                        {receiptBusy
                          ? "Checking confirmation…"
                          : "Check previous confirmation"}
                      </button>
                    )}
                  <button
                    className="primary-button"
                    disabled={
                      executing ||
                      expiredTransfer ||
                      planInvalidated ||
                      !config.capabilities.execution ||
                      !!uncertain.length ||
                      (nextStep > 0 &&
                        confirmedPriorHash !==
                          getStep(transfer)[String(nextStep - 1)])
                    }
                    onClick={() => execute(nextStep)}
                  >
                    {executing ? (
                      <>
                        <Loader2 className="spin" size={16} />
                        Waiting for wallet…
                      </>
                    ) : (
                      <>
                        Confirm step {nextStep + 1} in wallet
                        <ArrowRight size={15} />
                      </>
                    )}
                  </button>
                  {planInvalidated && !expiredTransfer && (
                    <p className="live-hint left">
                      Route or wallet state changed. Request a fresh quote
                      before signing. Existing transactions continue to be
                      tracked.
                    </p>
                  )}
                  {expiredTransfer && (
                    <p className="live-hint left">
                      The execution window expired. Do not repeat a submitted
                      transaction. Refresh the quote only for any remaining
                      work.
                    </p>
                  )}
                </>
              )}
              {transfer.txHashes
                ?.filter((hash) =>
                  safeExplorerUrl(
                    chains.find(
                      (c) => c.id === transfer.summary?.currencyOut.chainId,
                    )?.explorerUrl,
                    hash,
                  ),
                )
                .map((hash) => (
                  <a
                    className="live-explorer"
                    key={hash}
                    href={safeExplorerUrl(
                      chains.find(
                        (c) => c.id === transfer.summary?.currencyOut.chainId,
                      )?.explorerUrl,
                      hash,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Destination transaction
                    <ExternalLink size={13} />
                  </a>
                ))}
              <p className="live-hint left">
                A submitted transaction is not a completed transfer. Completion
                requires provider-reported success with a destination
                transaction hash.
              </p>
            </div>
          )}
        </aside>
      </div>
      {picker && (
        <LiveTokenPicker
          chain={picker === "from" ? sourceChain! : destChain!}
          network={network}
          onClose={closePicker}
          onSelect={(currency) => {
            if (picker === "from") {
              setFrom(currency);
              setBalance(null);
            } else setTo(currency);
            setPicker(null);
          }}
        />
      )}
      {settingsOpen && (
        <Modal
          title="Live preferences"
          subtitle="Saved to your verified account when synchronization is available."
          onClose={closeSettings}
        >
          <label className="live-field">
            Slippage tolerance (%)
            <input
              aria-label="Live slippage tolerance"
              inputMode="decimal"
              value={slippage}
              onChange={(e) => {
                if (/^\d*\.?\d{0,2}$/.test(e.target.value))
                  setSlippage(e.target.value);
              }}
            />
          </label>
          <p className="live-hint left">
            Server policy allows a maximum of {config.maxSlippageBps / 100}%.
            Quotes outside this limit are rejected.
          </p>
          <label className="live-checkbox">
            <input
              type="checkbox"
              checked={gasTopup}
              onChange={(e) => setGasTopup(e.target.checked)}
            />
            Request destination gas on eligible routes
          </label>
          <div className="live-mini-row">
            <span>Preferred appearance</span>
            <select
              aria-label="Synced appearance"
              value={prefs.settings.theme}
              onChange={(e) => {
                const theme = e.target.value as "light" | "dark";
                selectedTheme.current = theme;
                setPrefs((p) => ({ ...p, settings: { ...p.settings, theme } }));
                document.documentElement.dataset.theme = theme;
              }}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          {error && <p className="live-validation">{error}</p>}
          <button
            className="primary-button"
            disabled={
              !session ||
              saving ||
              !config.capabilities.sync ||
              !Number.isFinite(slippageBps) ||
              slippageBps < 0 ||
              slippageBps > config.maxSlippageBps
            }
            onClick={savePreferences}
          >
            {saving ? "Saving preferences…" : "Save to account"}
          </button>
          {!session && (
            <p className="live-hint">
              Sign in to sync preferences across devices.
            </p>
          )}
        </Modal>
      )}
      {review && quote && (
        <Modal
          title="Review your live route"
          subtitle={
            network === "mainnet"
              ? "Mainnet transfer · real funds"
              : "Testnet transfer · test tokens"
          }
          onClose={closeReview}
        >
          <div className="live-review-route">
            <div>
              <CurrencyMark currency={quote.summary.currencyIn} />
              <span>
                <strong>
                  {fromBaseUnits(
                    quote.summary.amountIn,
                    quote.summary.currencyIn.decimals,
                  )}{" "}
                  {quote.summary.currencyIn.symbol}
                </strong>
                <small>{sourceChain?.name}</small>
              </span>
            </div>
            <ArrowDown size={20} />
            <div>
              <CurrencyMark currency={quote.summary.currencyOut} />
              <span>
                <strong>
                  {fromBaseUnits(
                    quote.summary.amountOut,
                    quote.summary.currencyOut.decimals,
                  )}{" "}
                  {quote.summary.currencyOut.symbol}
                </strong>
                <small>{destChain?.name}</small>
              </span>
            </div>
          </div>
          <div className="review-details">
            <div>
              <span>Minimum received</span>
              <strong>
                {fromBaseUnits(
                  quote.summary.minimumAmountOut,
                  quote.summary.currencyOut.decimals,
                )}{" "}
                {quote.summary.currencyOut.symbol}
              </strong>
            </div>
            <div>
              <span>Quoted provider fees</span>
              <strong>
                {quote.summary.feesUsd === null
                  ? "Unavailable"
                  : `$${quote.summary.feesUsd}`}
              </strong>
            </div>
            <div>
              <span>Origin network gas</span>
              <strong>Shown by your wallet</strong>
            </div>
            <div>
              <span>Recipient</span>
              <strong>
                {short(
                  customRecipient ? recipient : session?.user.address || "",
                )}
              </strong>
            </div>
            <div>
              <span>Estimated duration</span>
              <strong>
                {quote.summary.timeEstimate === null
                  ? "Unavailable"
                  : `${quote.summary.timeEstimate}s`}
              </strong>
            </div>
            <div>
              <span>Quote expires</span>
              <strong className={remaining < 10 ? "live-validation" : ""}>
                {remaining > 0 ? `${remaining}s` : "Expired"}
              </strong>
            </div>
          </div>
          {!quote.executable && (
            <div className="live-setup-note">
              <Info size={16} />
              <span>
                {quote.executionBlockReason ||
                  "This route is not enabled for execution. No transaction will be requested."}
              </span>
            </div>
          )}
          {error && (
            <p className="live-validation" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button"
            disabled={
              !quote.executable ||
              remaining <= 0 ||
              executing ||
              !config.capabilities.execution ||
              !!uncertain.length ||
              !!pending.length
            }
            onClick={confirmQuote}
          >
            {executing ? (
              <>
                <Loader2 className="spin" size={16} />
                Preparing route…
              </>
            ) : (
              <>
                Prepare {network} transfer
                <ArrowRight size={16} />
              </>
            )}
          </button>
          <p className="live-hint">
            You will review and confirm each transaction in your wallet. Your
            private keys stay with you.
          </p>
        </Modal>
      )}
    </section>
  );
}
function LiveTokenPicker({
  chain,
  network,
  onSelect,
  onClose,
}: {
  chain: LiveChain;
  network: Network;
  onSelect: (currency: LiveCurrency) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState(""),
    [currencies, setCurrencies] = useState<LiveCurrency[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api<{ currencies: LiveCurrency[] }>("/currencies", {
        body: {
          network,
          search: {
            chainIds: [chain.id],
            ...(term
              ? isEvmAddress(term)
                ? { address: term }
                : { term }
              : {}),
            limit: 30,
          },
        },
        signal: controller.signal,
      })
        .then((result) => {
          if (active) setCurrencies(result.currencies);
        })
        .catch((err) => {
          if (active) setError(explain(err));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, chain.id, network]);
  return (
    <Modal
      title={`Choose a token on ${chain.displayName || chain.name}`}
      subtitle="Network-specific token metadata from the provider."
      onClose={onClose}
    >
      <div className="search-field">
        <Search size={17} />
        <input
          aria-label="Search live tokens"
          value={term}
          onChange={(e) => setTerm(e.target.value.trim())}
          placeholder="Name, symbol, or contract address"
        />
      </div>
      <div className="live-token-results">
        {loading ? (
          <div className="live-loading" role="status">
            <Loader2 size={22} className="spin" />
            Searching verified assets…
          </div>
        ) : error ? (
          <p className="live-validation" role="alert">
            {error}
          </p>
        ) : !currencies.length ? (
          <div className="live-empty">
            <Search size={25} />
            <p>No supported tokens matched. Try another search.</p>
          </div>
        ) : (
          currencies.map((c) => (
            <button key={c.address} onClick={() => onSelect(c)}>
              <CurrencyMark currency={c} />
              <span>
                <strong>{c.symbol}</strong>
                <small>{c.name}</small>
                <code>{short(c.address)}</code>
              </span>
              <Check size={16} />
            </button>
          ))
        )}
      </div>
      <p className="live-hint left">
        Always verify the network and contract address. Tokens are not
        interchangeable across networks.
      </p>
    </Modal>
  );
}
