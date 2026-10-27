import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  Github,
  Palette,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import "./company.css";

export type CompanyPage = "blog" | "brand" | "jobs";
const REPOSITORY = "https://github.com/miku0027-ops/crypto_swap_app";

function CompanyHeading({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <header className="company-heading">
      <span className="company-eyebrow">{label}</span>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

function Journal() {
  return (
    <>
      <CompanyHeading label="THE HOPLANE JOURNAL" title="Blog">
        Ideas, product notes, and practical guides for your next move.
      </CompanyHeading>
      <a
        className="company-feature"
        href="#company/blog"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          const article = document.getElementById("building-hoplane");
          const content = article?.querySelector("details");
          if (content) content.open = true;
          article?.scrollIntoView?.({
            behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
            block: "start",
          });
        }}
      >
        <div className="company-feature-copy">
          <span className="company-category">PRODUCT NOTES</span>
          <h2>
            Building a clearer way
            <br />
            to move across chains.
          </h2>
          <p>
            A closer look at Hoplane’s first steps, the choices behind them, and
            what is available today.
          </p>
          <span className="company-text-link">
            Read the story <ArrowRight size={17} />
          </span>
        </div>
        <div className="company-feature-art" aria-hidden="true">
          <div className="company-orbit orbit-one" />
          <div className="company-orbit orbit-two" />
          <div className="company-art-mark">
            <img src="/brand/hoplane-icon.svg" alt="" />
          </div>
          <span className="company-art-dot dot-one" />
          <span className="company-art-dot dot-two" />
        </div>
      </a>
      <div className="company-section-title">
        <h2>From the team</h2>
        <span>Product & practical guides</span>
      </div>
      <div className="company-journal-grid">
        <article id="building-hoplane" className="company-article">
          <div className="company-article-icon">
            <Sprout size={23} />
          </div>
          <span className="company-category">PRODUCT NOTES</span>
          <h2>Building Hoplane</h2>
          <p className="company-article-intro">
            A thoughtful interface starts with being clear about what happens to
            your funds.
          </p>
          <p>
            Hoplane brings route selection, wallet verification, and transfer
            tracking into one workspace. The live experience uses our backend to
            validate requests and retrieve routes from Relay. Your connected
            wallet signs transactions.
          </p>
          <details>
            <summary>
              Read the full product note <ArrowDownToLine size={14} />
            </summary>
            <div className="company-article-body">
              <h3>Start with a clear distinction</h3>
              <p>
                Demo mode lets you explore the interface using simulated data.
                Live mode starts on testnet and shows the services enabled by
                the deployment. A service that is unavailable is identified on
                screen.
              </p>
              <h3>Review, then authorize</h3>
              <p>
                Quotes show the expected output, minimum received, available fee
                estimates, and an expiry window. Live execution is limited to
                explicitly configured EVM routes. Routes that require
                unsupported transaction steps stay blocked.
              </p>
              <h3>Know where things stand</h3>
              <p>
                Wallet submission begins tracking. A completed transfer requires
                provider-reported success with a destination transaction hash. A
                submitted transaction can be recovered by its hash without
                asking the wallet to send it again.
              </p>
              <p>
                Our current focus is validating this foundation. Mainnet
                availability depends on the deployment’s supported networks,
                provider configuration, and execution policy.
              </p>
              <a
                className="company-text-link"
                href={REPOSITORY}
                target="_blank"
                rel="noreferrer"
              >
                Explore the project <ArrowUpRight size={15} />
              </a>
            </div>
          </details>
        </article>
        <article id="wallet-approval" className="company-article">
          <div className="company-article-icon">
            <ShieldCheck size={23} />
          </div>
          <span className="company-category">WALLET GUIDE</span>
          <h2>How wallet approval works</h2>
          <p className="company-article-intro">
            Understand each request before you confirm it in your wallet.
          </p>
          <p>
            Signing in proves you control your wallet address. Hoplane asks you
            to sign a time-limited message, then creates a session for your
            preferences and transfer history. This sign-in message does not
            transfer tokens.
          </p>
          <details>
            <summary>
              Read the wallet guide <ArrowDownToLine size={14} />
            </summary>
            <div className="company-article-body">
              <h3>1. Check the quote</h3>
              <p>
                Review both networks, the selected assets, the recipient, the
                minimum received, and any available fee estimate. Mainnet uses
                real funds; testnet uses test tokens.
              </p>
              <h3>2. Check the transaction</h3>
              <p>
                After preparing an executable route, review its destination
                address, value, network, and transaction data. Hoplane checks
                the connected account, network, expiry, and server authorization
                before requesting a wallet transaction. The wallet also
                simulates gas estimation.
              </p>
              <h3>3. Confirm in your wallet</h3>
              <p>
                The wallet presents the final request. Reject it if anything
                differs from your intention. A rejected transaction requires a
                fresh quote before another attempt.
              </p>
              <h3>4. Follow the status</h3>
              <p>
                If a wallet submission result is uncertain, check your wallet
                activity and recover the transaction hash. Use the tracking
                recovery action for an existing transaction. Requesting another
                send can move funds twice.
              </p>
              <p>
                Hoplane’s current execution policy blocks unsupported approvals,
                permits, and arbitrary router calls. Your seed phrase and
                private keys stay in your wallet; Hoplane never asks for them.
              </p>
            </div>
          </details>
        </article>
      </div>
      <div className="company-bottom-note">
        <BookOpen size={18} />
        <p>
          These notes describe the current implementation. The live app shows
          the services and routes enabled for your environment.
        </p>
      </div>
    </>
  );
}

function BrandAssets() {
  const colors = [
    { name: "Forest", hex: "#20382E", className: "forest" },
    { name: "Lime", hex: "#D5F58C", className: "lime" },
    { name: "Cloud", hex: "#F7F8F5", className: "cloud" },
    { name: "Sage", hex: "#6C7C67", className: "sage" },
  ];
  return (
    <>
      <CompanyHeading
        label="MADE TO MOVE, BUILT TO BELONG"
        title="Brand assets"
      >
        The Hoplane identity, ready for your next story, presentation, or
        integration.
      </CompanyHeading>
      <div className="company-assets-grid">
        <section className="company-asset">
          <div className="company-asset-preview wordmark">
            <img
              src="/brand/hoplane-logo.svg"
              alt="Hoplane wordmark with its two diagonal lane symbol"
            />
          </div>
          <div className="company-asset-info">
            <div>
              <h2>Primary wordmark</h2>
              <p>Forest · transparent background · SVG</p>
            </div>
            <a
              className="company-download"
              href="/brand/hoplane-logo.svg"
              download="hoplane-logo.svg"
              aria-label="Download Hoplane wordmark SVG"
            >
              <ArrowDownToLine size={17} />
              Download SVG
            </a>
          </div>
        </section>
        <section className="company-asset">
          <div className="company-asset-preview icon">
            <img
              src="/brand/hoplane-icon.svg"
              alt="Hoplane symbol, two parallel diagonal lanes"
            />
          </div>
          <div className="company-asset-info">
            <div>
              <h2>App symbol</h2>
              <p>Forest · transparent background · SVG</p>
            </div>
            <a
              className="company-download"
              href="/brand/hoplane-icon.svg"
              download="hoplane-icon.svg"
              aria-label="Download Hoplane icon SVG"
            >
              <ArrowDownToLine size={17} />
              Download SVG
            </a>
          </div>
        </section>
      </div>
      <div className="company-section-title">
        <h2>A little forest. A little energy.</h2>
        <span>Our color palette</span>
      </div>
      <div className="company-palette" aria-label="Hoplane color palette">
        {colors.map((color) => (
          <div className="company-swatch" key={color.name}>
            <div className={`company-swatch-color ${color.className}`} />
            <div>
              <h3>{color.name}</h3>
              <code>{color.hex}</code>
            </div>
          </div>
        ))}
      </div>
      <section className="company-usage">
        <div>
          <Palette size={24} />
          <h2>Keep it clear.</h2>
          <p>
            A few simple guidelines help our identity feel consistent wherever
            it appears.
          </p>
        </div>
        <ul>
          <li>
            <strong>Give the mark room.</strong>
            <span>
              Keep clear space around the logo at least the width of the app
              symbol.
            </span>
          </li>
          <li>
            <strong>Preserve the proportions.</strong>
            <span>
              Use the supplied SVG files and scale them evenly. Keep the
              wordmark and symbol intact.
            </span>
          </li>
          <li>
            <strong>Choose a readable background.</strong>
            <span>
              Use Forest on Cloud or Lime. Keep essential text high contrast and
              avoid Lime text on a light surface.
            </span>
          </li>
          <li>
            <strong>Make the relationship clear.</strong>
            <span>
              Use these assets when referring to Hoplane. Do not imply an
              endorsement or partnership that has not been agreed.
            </span>
          </li>
        </ul>
      </section>
    </>
  );
}

function Careers() {
  return (
    <>
      <CompanyHeading label="GOOD PEOPLE. THOUGHTFUL PRODUCTS." title="Careers">
        Help make moving across chains feel a little more human.
      </CompanyHeading>
      <section className="company-careers-hero">
        <div className="company-careers-illustration" aria-hidden="true">
          <Code2 size={47} strokeWidth={1.5} />
          <span className="company-careers-symbol">
            <img src="/brand/hoplane-icon.svg" alt="" />
          </span>
        </div>
        <div>
          <span className="company-category">BUILDING THE FOUNDATION</span>
          <h2>
            Care about the details?
            <br />
            So do we.
          </h2>
          <p>
            Clear interfaces, careful transaction handling, and honest product
            communication shape the work behind Hoplane. The project is still
            developing its foundation.
          </p>
          <a
            className="company-text-link"
            href={REPOSITORY}
            target="_blank"
            rel="noreferrer"
          >
            See what we’re building <ArrowUpRight size={16} />
          </a>
        </div>
      </section>
      <section className="company-openings">
        <div>
          <span className="company-eyebrow">OPEN ROLES</span>
          <h2>No openings announced yet.</h2>
          <p>
            There are no published job openings or application forms at this
            time. When roles are available, we’ll share the details here.
          </p>
        </div>
        <Sprout size={35} strokeWidth={1.4} />
      </section>
      <section className="company-contribute">
        <Github size={27} />
        <div>
          <h2>Explore the project on GitHub.</h2>
          <p>
            You can review the code and use the repository’s issue tracker for
            reproducible bugs or feature suggestions. Repository participation
            is separate from employment.
          </p>
        </div>
        <a
          className="company-download"
          href={REPOSITORY}
          target="_blank"
          rel="noreferrer"
        >
          Visit repository <ArrowUpRight size={16} />
        </a>
      </section>
    </>
  );
}

export default function CompanyView({ page }: { page: CompanyPage }) {
  return (
    <div className={`company-page company-page-${page}`}>
      {page === "blog" ? (
        <Journal />
      ) : page === "brand" ? (
        <BrandAssets />
      ) : (
        <Careers />
      )}
    </div>
  );
}
