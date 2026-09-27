import { describe, expect, it } from "vitest";
import { boxAt, placementAllowed, rectanglesOverlap } from "../src/ui/toolbarPlacement";

describe("toolbar placement guards", () => {
  it("rejects a candidate that intersects native actions even after overflow correction", () => {
    const toolbar = boxAt(900, 16, 160, 28);
    const share = { rect: boxAt(920, 12, 28, 28), kind: "native-action" as const };
    expect(rectanglesOverlap(toolbar, share.rect)).toBe(true);
    expect(placementAllowed(toolbar, [share], { width: 1200, height: 800 })).toBe(false);
  });

  it("accepts a left-of-actions placement that stays in the viewport", () => {
    const toolbar = boxAt(732, 12, 160, 28);
    const share = { rect: boxAt(900, 12, 28, 28), kind: "native-action" as const };
    expect(placementAllowed(toolbar, [share], { width: 1200, height: 800 })).toBe(true);
  });
});
