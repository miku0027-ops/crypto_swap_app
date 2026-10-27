import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { SQLiteStore, FirestoreStore } from "./store.js";
import { RpcService } from "./rpc.js";

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
  setGlobalDispatcher(new EnvHttpProxyAgent());
const config = readConfig();
const store =
  config.storeDriver === "firestore"
    ? new FirestoreStore(
        getFirestore(
          initializeApp({
            credential: applicationDefault(),
            projectId: config.firebaseProjectId,
          }),
        ),
      )
    : new SQLiteStore(config.databasePath);
let urls: Record<number, string> = {};
try {
  urls = JSON.parse(process.env.RPC_URLS_JSON || "{}");
  if (!urls || Array.isArray(urls) || typeof urls !== "object") throw Error();
} catch {
  throw Error(
    "RPC_URLS_JSON must be an object of server-owned chain endpoints.",
  );
}
const rpc = new RpcService(urls, fetch, 8000, {
  allowLocalHttp: config.nodeEnv !== "production",
});
const hops =
  process.env.TRUST_PROXY_HOPS === undefined
    ? 0
    : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isInteger(hops) || hops < 0 || hops > 2)
  throw Error("TRUST_PROXY_HOPS must be 0, 1 or 2.");
// Require durable storage access before accepting requests; missing cloud credentials fail closed.
await store.get("health", "startup");
const app = await buildApp({
  config,
  store,
  rpc,
  logger: true,
  serveStatic: true,
  trustProxyHops: hops || undefined,
});
await app.listen({ host: config.host, port: config.port });
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  process.exitCode = 0;
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
