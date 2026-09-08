import { describe, it, expect } from "vitest";
import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("accepts ordinary same-origin paths", () => {
    expect(safeRedirect("/")).toBe("/");
    expect(safeRedirect("/join/ABC123XYZ456")).toBe("/join/ABC123XYZ456");
    expect(safeRedirect("/p/sunday-league/r/MD1")).toBe("/p/sunday-league/r/MD1");
    expect(safeRedirect("/p/pool?tab=total#row")).toBe("/p/pool?tab=total#row");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirect("https://evil.example")).toBeNull();
    expect(safeRedirect("http://evil.example/join")).toBeNull();
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect("data:text/html,<script>")).toBeNull();
  });

  it("rejects protocol-relative URLs that browsers resolve off-origin", () => {
    expect(safeRedirect("//evil.example")).toBeNull();
    expect(safeRedirect("//evil.example/join")).toBeNull();
  });

  it("rejects backslash variants browsers may normalise to a slash", () => {
    expect(safeRedirect("/\\evil.example")).toBeNull();
    expect(safeRedirect("/path\\to\\thing")).toBeNull();
  });

  it("rejects header injection through control characters", () => {
    expect(safeRedirect("/ok\r\nSet-Cookie: a=b")).toBeNull();
    expect(safeRedirect("/ok\nLocation: https://evil.example")).toBeNull();
    expect(safeRedirect(`/ok${String.fromCharCode(0)}`)).toBeNull();
    expect(safeRedirect(`/ok${String.fromCharCode(0x7f)}`)).toBeNull();
  });

  it("rejects non-strings, empties and absurd lengths", () => {
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect(42)).toBeNull();
    expect(safeRedirect({})).toBeNull();
    expect(safeRedirect("")).toBeNull();
    expect(safeRedirect(`/${"a".repeat(600)}`)).toBeNull();
  });

  it("does not reject ordinary printable characters", () => {
    // Guards the specific bug of writing the forbidden set as a character
    // range that accidentally spans letters and digits.
    expect(safeRedirect("/AaZz09-_~.%20")).toBe("/AaZz09-_~.%20");
  });
});
