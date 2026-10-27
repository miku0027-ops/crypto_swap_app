import { readFile, readdir, mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "vite";

// Worker ESM starter contract: embed static assets and export default.fetch.
// The existing Vite/Node outputs are preserved; this is a separate Site artifact.
const root = process.cwd(),
  out = path.join(root, "dist-site");
const manifest = JSON.parse(await readFile(".openai/hosting.json", "utf8"));
assert(
  manifest.project_id && !manifest.static,
  "Worker hosting must preserve the Site ID and omit static",
);
const assets = {};
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const name = `/${path.relative(path.join(root, "dist"), file).replaceAll(path.sep, "/")}`;
      assert(types[path.extname(file)], `Unsupported asset type: ${name}`);
      assets[name] = {
        contentType: types[path.extname(file)],
        body: (await readFile(file)).toString("base64"),
      };
    }
  }
}
await walk(path.join(root, "dist"));
assert(assets["/index.html"], "Build the web app before packaging the Site");
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, ".openai"), { recursive: true });
await copyFile(".openai/hosting.json", path.join(out, ".openai/hosting.json"));
await build({
  configFile: false,
  publicDir: false,
  plugins: [
    {
      name: "hoplane-worker-entry",
      resolveId(id) {
        if (id.endsWith("virtual:hoplane-worker")) return "\0hoplane-worker";
      },
      load(id) {
        if (id === "\0hoplane-worker")
          return `import { createTransactionsWorker } from ${JSON.stringify(path.join(root, "worker/transactions-worker.ts"))}; export default createTransactionsWorker(${JSON.stringify(assets)});`;
      },
    },
  ],
  build: {
    outDir: path.join(out, "dist/server"),
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    lib: {
      entry: "virtual:hoplane-worker",
      formats: ["es"],
      fileName: () => "index.js",
    },
  },
});
const source = await readFile(path.join(out, "dist/server/index.js"), "utf8");
const module = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
assert.equal(typeof module.default?.fetch, "function");
const response = await module.default.fetch(
  new Request("https://hoplane.example/"),
);
assert.equal(response.status, 200);
assert((await response.text()).includes("<html"));
console.log(
  `Validated Site Worker and ${Object.keys(assets).length} embedded assets`,
);
