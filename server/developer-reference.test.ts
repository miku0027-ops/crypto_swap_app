import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  API_ENDPOINTS,
  CONSOLE_PATHS,
  openApiDocument,
} from "./developer-reference";
describe("Hoplane developer contract", () => {
  it("documents every implemented Node route with its real method", () => {
    const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
    const implemented = [
      ...source.matchAll(/app\.(get|post|put)\("\/api([^"\n]+)"/g),
    ]
      .map((m) => `${m[1].toUpperCase()} ${m[2].replace(/:id/g, "{id}")}`)
      .sort();
    expect(API_ENDPOINTS.map((e) => `${e.method} ${e.path}`).sort()).toEqual(
      implemented,
    );
  });
  it("publishes relative paths, protected-write security and no provider secrets", () => {
    const doc = openApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "/api" }]);
    expect(doc.paths["/quotes"].post).toMatchObject({
      security: [{ walletSession: [], csrfToken: [] }],
    });
    expect(doc.paths["/quotes/{id}/prepare"].post).toMatchObject({
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", required: true }),
      ]),
    });
    expect(doc.paths["/transactions/stream"].get).toMatchObject({
      responses: {
        "200": {
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
      },
    });
  });
  it("limits the request tester to fixed public GET routes", () => {
    for (const path of CONSOLE_PATHS) {
      const e = API_ENDPOINTS.find(
        (e) => e.path === path.split("?")[0] && e.method === "GET",
      );
      expect(e?.auth).toBe("public");
    }
    expect(
      CONSOLE_PATHS.some((p) => p.includes("auth/") || p.includes("transfers")),
    ).toBe(false);
  });
});
