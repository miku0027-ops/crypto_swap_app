import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
const Transactions = lazy(() => import("./TransactionsView"));
/** Keep the feed, validation schemas and table out of the initial swap bundle. */
export default function TransactionsPage(props: {
  personal: ReactNode;
  initialScope?: "network" | "personal";
  personalLabel?: string;
}) {
  return (
    <Suspense
      fallback={
        <div className="live-loading" role="status">
          Loading transactions…
        </div>
      }
    >
      <Transactions {...props} />
    </Suspense>
  );
}
