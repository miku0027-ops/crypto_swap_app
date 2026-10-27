export const NAVIGATION_PAGES = [
  "swap",
  "vaults",
  "activity",
  "portfolio",
  "explore",
  "help",
  "blog",
  "brand",
  "jobs",
  "solutions-wallets",
  "solutions-apps",
  "solutions-chains",
  "solutions-payments",
  "product-dashboard",
  "product-app",
  "product-api",
  "product-protocol",
  "product-kit",
  "documentation",
  "api-reference",
  "testnets",
  "explorer",
  "status",
  "app-balance",
  "withdraw",
  "terms",
  "privacy",
] as const;
export type NavigationPage = (typeof NAVIGATION_PAGES)[number];
export type CompanyPage = "blog" | "brand" | "jobs";
export const isNavigationPage = (value: string): value is NavigationPage =>
  (NAVIGATION_PAGES as readonly string[]).includes(value);
export const isCompanyPage = (page: NavigationPage): page is CompanyPage =>
  page === "blog" || page === "brand" || page === "jobs";
export const isResourcePage = (page: NavigationPage): boolean =>
  ![
    "swap",
    "vaults",
    "activity",
    "portfolio",
    "explore",
    "help",
    "blog",
    "brand",
    "jobs",
  ].includes(page);
export function pageFromLocation(): NavigationPage {
  const value = location.hash.replace(/^#(?:company\/|\/)/, "");
  return isNavigationPage(value) ? value : "swap";
}
export const pageHref = (page: NavigationPage): string =>
  isCompanyPage(page) ? `#company/${page}` : `#/${page}`;
export const PRIMARY_NAVIGATION = [
  { page: "swap", label: "Swap" },
  { page: "vaults", label: "Vaults" },
  { page: "activity", label: "Transactions" },
] as const;
export const NAVIGATION_SECTIONS: {
  label: string;
  items: { page: NavigationPage; label: string; description: string }[];
}[] = [
  {
    label: "Solutions",
    items: [
      {
        page: "solutions-wallets",
        label: "Wallets",
        description: "Connect balances across networks",
      },
      {
        page: "solutions-apps",
        label: "Multichain Apps",
        description: "Build connected app experiences",
      },
      {
        page: "solutions-chains",
        label: "Chains",
        description: "Explore network connectivity",
      },
      {
        page: "solutions-payments",
        label: "Commerce & Payments",
        description: "Understand cross-chain payments",
      },
    ],
  },
  {
    label: "Products",
    items: [
      {
        page: "product-dashboard",
        label: "Dashboard",
        description: "Integration and account tools",
      },
      {
        page: "product-app",
        label: "Hoplane App",
        description: "Swap, bridge, and track transfers",
      },
      {
        page: "product-api",
        label: "API",
        description: "Validated application endpoints",
      },
      {
        page: "product-protocol",
        label: "Protocol",
        description: "How cross-chain settlement works",
      },
      {
        page: "product-kit",
        label: "RelayKit",
        description: "Provider UI and SDK reference",
      },
    ],
  },
  {
    label: "Developers",
    items: [
      {
        page: "documentation",
        label: "Documentation",
        description: "Browse the complete reference index",
      },
      {
        page: "api-reference",
        label: "API Reference",
        description: "Requests, responses, and examples",
      },
      {
        page: "testnets",
        label: "Testnets",
        description: "Develop using test tokens",
      },
      {
        page: "explorer",
        label: "Relay Chain Explorer",
        description: "Inspect provider-chain activity",
      },
      {
        page: "status",
        label: "API Status",
        description: "Check services and availability",
      },
    ],
  },
  {
    label: "Company",
    items: [
      {
        page: "blog",
        label: "Blog",
        description: "Product notes and practical guides",
      },
      {
        page: "brand",
        label: "Brand Assets",
        description: "Logos, colors, and usage",
      },
      {
        page: "jobs",
        label: "Jobs",
        description: "Careers and project participation",
      },
    ],
  },
  {
    label: "App Resources",
    items: [
      {
        page: "help",
        label: "Help Center",
        description: "Answers and transfer support",
      },
      {
        page: "app-balance",
        label: "App Balance",
        description: "Provider integrator balance guide",
      },
      {
        page: "withdraw",
        label: "Withdraw Funds",
        description: "Recover eligible provider deposits",
      },
      {
        page: "portfolio",
        label: "My Account",
        description: "Wallet, preferences, and balances",
      },
      {
        page: "explore",
        label: "Explore networks",
        description: "Browse supported network information",
      },
      {
        page: "terms",
        label: "Terms of Use",
        description: "Using this preview application",
      },
      {
        page: "privacy",
        label: "Privacy Policy",
        description: "Understand how data is handled",
      },
    ],
  },
];
