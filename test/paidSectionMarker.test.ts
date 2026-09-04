import { describe, expect, it } from "vitest";
import { CURRENT_PAID_SECTION_MARKER, detectPaidSectionMarker } from "../src/agents/shared/paidSectionMarker";

describe("detectPaidSectionMarker", () => {
  it("detects the current plain-text marker", () => {
    expect(detectPaidSectionMarker("無料部分\n[PAID_SECTION]\n有料部分")).toBe(CURRENT_PAID_SECTION_MARKER);
  });

  it("falls back to the legacy HTML-comment marker when that's what the draft actually contains", () => {
    expect(detectPaidSectionMarker("無料部分\n<!-- PAID_SECTION -->\n有料部分")).toBe(
      "<!-- PAID_SECTION -->"
    );
  });

  it("defaults to the current marker when neither is present", () => {
    expect(detectPaidSectionMarker("マーカーなしの本文")).toBe(CURRENT_PAID_SECTION_MARKER);
  });
});
