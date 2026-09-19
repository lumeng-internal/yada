import { afterEach, describe, expect, it } from "vitest";
import { RAIL_HOST_ID } from "../src/rail/view";
import {
  officialNavigationHideGate,
  OfficialNavigationVisibilityController,
  OFFICIAL_NAV_STYLE_ID
} from "../src/navigation/officialVisibility";
import { mountMain, mountOfficialButtons } from "./navFixtures";

function mountRailHost(hidden = false): HTMLElement {
  document.getElementById(RAIL_HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = RAIL_HOST_ID;
  host.hidden = hidden;
  document.documentElement.append(host);
  return host;
}

function hiddenStyle(): HTMLElement | null {
  return document.getElementById(OFFICIAL_NAV_STYLE_ID);
}

describe("official navigation visibility", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.getElementById(RAIL_HOST_ID)?.remove();
  });

  it("does not hide official navigation when Yada has no turns", () => {
    mountMain();
    mountOfficialButtons(3);
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [] }
    }));
    expect(hiddenStyle()).toBeNull();
    controller.dispose();
  });

  it("hides official navigation when Yada rail is ready and the official root is unique", () => {
    mountMain();
    const buttons = mountOfficialButtons(3);
    const clicks: number[] = [];
    buttons[1]!.addEventListener("click", () => clicks.push(1));
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [{}, {}, {}] }
    }));

    expect(hiddenStyle()?.textContent).toContain("opacity: 0");
    expect(hiddenStyle()?.textContent).toContain("pointer-events: none");
    expect(document.querySelectorAll("main button")).toHaveLength(3);
    buttons[1]!.click();
    expect(clicks).toEqual([1]);
    controller.dispose();
  });

  it("restores official navigation when the snapshot is cleared", () => {
    mountMain();
    mountOfficialButtons(3);
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [{}, {}] }
    }));
    expect(hiddenStyle()).toBeTruthy();
    controller.update(officialNavigationHideGate({ conversationPage: true, snapshot: null }));
    expect(hiddenStyle()).toBeNull();
    controller.dispose();
  });

  it("restores official navigation on route switch", () => {
    mountMain();
    mountOfficialButtons(3);
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [{}, {}] }
    }));
    expect(hiddenStyle()).toBeTruthy();
    controller.update(officialNavigationHideGate({
      conversationPage: false,
      snapshot: { activeTurns: [{}, {}] }
    }));
    expect(hiddenStyle()).toBeNull();
    controller.dispose();
  });

  it("restores official navigation on dispose", () => {
    mountMain();
    mountOfficialButtons(3);
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [{}, {}] }
    }));
    expect(hiddenStyle()).toBeTruthy();
    controller.dispose();
    expect(hiddenStyle()).toBeNull();
  });

  it("does not hide when multiple official roots cannot be uniquely identified", () => {
    mountMain();
    mountOfficialButtons(2);
    mountOfficialButtons(2);
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [{}, {}] }
    }));
    expect(hiddenStyle()).toBeNull();
    controller.dispose();
  });

  it("fails open for ordinary navigation", () => {
    mountMain();
    const nav = document.createElement("nav");
    nav.innerHTML = '<button aria-label="Settings">Settings</button>';
    document.querySelector("main")!.append(nav);
    mountRailHost();
    const controller = new OfficialNavigationVisibilityController();
    controller.update(officialNavigationHideGate({
      conversationPage: true,
      snapshot: { activeTurns: [{}] }
    }));
    expect(document.querySelector("nav button")).toBeTruthy();
    expect(hiddenStyle()).toBeNull();
    controller.dispose();
  });
});
