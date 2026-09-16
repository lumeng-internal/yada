export type YadaTheme = "light" | "dark";

export function detectYadaTheme(): YadaTheme {
  const html = document.documentElement;
  const themeAttr = safeGetAttribute(html, "data-theme") ?? safeGetAttribute(document.body, "data-theme");
  if (themeAttr?.toLowerCase().includes("dark")) return "dark";
  if (themeAttr?.toLowerCase().includes("light")) return "light";
  if (html.classList.contains("dark")) return "dark";
  if (html.classList.contains("light")) return "light";

  const colorScheme = getComputedStyle(html).colorScheme;
  if (colorScheme.includes("dark")) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function safeGetAttribute(node: Element | null | undefined, name: string): string | null {
  return node instanceof Element ? node.getAttribute(name) : null;
}

export function observeYadaTheme(onChange: (theme: YadaTheme) => void): () => void {
  const applyTheme = (): void => onChange(detectYadaTheme());
  const observer = new MutationObserver(applyTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"]
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-theme"]
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", applyTheme);
  applyTheme();

  return () => {
    observer.disconnect();
    media.removeEventListener("change", applyTheme);
  };
}
