import { afterEach, describe, expect, it } from "vitest";
import { OfficialNavigationVisibilityController, OFFICIAL_NAV_STYLE_ID } from "../src/navigation/officialVisibility";
import { mountMain, mountOfficialButtons } from "./navFixtures";

describe("official navigation visibility", () => {
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("hides the official rail visually without removing buttons and restores on dispose", () => {
    mountMain();
    const buttons = mountOfficialButtons(3);
    const clicks: number[] = [];
    buttons[1]!.addEventListener("click", () => clicks.push(1));
    const controller = new OfficialNavigationVisibilityController();
    controller.setEnabled(true);

    const style = document.getElementById(OFFICIAL_NAV_STYLE_ID);
    expect(style?.textContent).toContain("opacity: 0");
    expect(style?.textContent).toContain("pointer-events: none");
    expect(document.querySelectorAll("main button")).toHaveLength(3);
    buttons[1]!.click();
    expect(clicks).toEqual([1]);

    controller.dispose();
    expect(document.getElementById(OFFICIAL_NAV_STYLE_ID)).toBeNull();
  });

  it("fails open for ordinary navigation", () => {
    mountMain();
    const nav = document.createElement("nav");
    nav.innerHTML = '<button aria-label="Settings">Settings</button>';
    document.querySelector("main")!.append(nav);
    const controller = new OfficialNavigationVisibilityController();
    controller.setEnabled(true);
    expect(document.querySelector("nav button")).toBeTruthy();
    controller.dispose();
  });
});
