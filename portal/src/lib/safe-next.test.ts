import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  const site = "https://portal.mlinjanafinancialgroup.com";
  it("keeps paths on this site", () => expect(safeNext("/apply")).toBe("/apply"));
  it("keeps full URLs on this site", () => expect(safeNext(`${site}/join/details?x=1`, "/", site)).toBe("/join/details?x=1"));
  it("refuses other sites", () => {
    expect(safeNext("https://evil.example/x", "/", site)).toBe("/");
    expect(safeNext("//evil.example/x")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)", "/", site)).toBe("/");
  });
  it("falls back when empty", () => expect(safeNext(null, "/home")).toBe("/home"));
});
