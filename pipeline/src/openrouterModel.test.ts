import { describe, it, expect, vi } from "vitest";
import { resolveFreeModel, fetchFreeModelCatalog, PREFERRED_MODELS } from "./openrouterModel";

function catalogResponse(ids: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  } as unknown as Response;
}

describe("dynamic free-model resolution", () => {
  it("prefers the first PREFERRED_MODELS entry still in the catalog", async () => {
    const r = await resolveFreeModel(undefined, ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"]);
    expect(r.model).toBe("google/gemma-4-31b-it:free");
    expect(r.reason).toContain("PREFERRED_MODELS");
  });

  it("falls back to the alphabetically first free model when no preference survives", async () => {
    const r = await resolveFreeModel(undefined, ["zzz/last-standing:free", "aaa/first-standing:free"]);
    expect(r.model).toBe("aaa/first-standing:free");
    expect(r.reason).toContain("alphabetically first");
  });

  it("throws when the catalog has no free models at all", async () => {
    await expect(resolveFreeModel(undefined, [])).rejects.toThrow("no :free models");
  });

  it("an explicit pin wins when it is still listed", async () => {
    const r = await resolveFreeModel("google/gemma-4-31b-it:free", ["google/gemma-4-31b-it:free"]);
    expect(r.model).toBe("google/gemma-4-31b-it:free");
    expect(r.reason).toContain("pin");
  });

  it("a pin naming a DELISTED model throws BEFORE any request", async () => {
    // The 2026-10-06 incident: qwen/qwen3.8-27b:free vanished from the
    // catalog and every call 404'd. This must be a loud pre-request failure.
    await expect(resolveFreeModel("qwen/qwen3.8-27b:free", ["google/gemma-4-31b-it:free"]))
      .rejects.toThrow("delisted");
  });

  it("refuses a pin that is not a :free variant (budget guard)", async () => {
    await expect(resolveFreeModel("openai/gpt-4o", ["openai/gpt-4o"])).rejects.toThrow(":free");
  });

  it("catalog fetch returns only :free ids, sorted", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      catalogResponse(["b/b:free", "a/a:free", "c/c-paid", "d/d:free"]),
    );
    const ids = await fetchFreeModelCatalog();
    expect(ids).toEqual(["a/a:free", "b/b:free", "d/d:free"]);
    spy.mockRestore();
  });

  it("catalog fetch failure is an error, not a silent fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    await expect(fetchFreeModelCatalog()).rejects.toThrow("HTTP 503");
  });

  it("PREFERRED_MODELS contains no delisted model as of 2026-10-06", () => {
    // Guard against re-introducing the dead qwen pin.
    expect(PREFERRED_MODELS).not.toContain("qwen/qwen3.8-27b:free");
    for (const m of PREFERRED_MODELS) expect(m.endsWith(":free")).toBe(true);
  });
});