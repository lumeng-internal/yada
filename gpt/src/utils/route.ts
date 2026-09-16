export function observeRouteChange(onChange: (url: string, previousUrl: string) => void): () => void {
  let previousUrl = window.location.href;

  const check = (): void => {
    const currentUrl = window.location.href;
    if (currentUrl === previousUrl) return;
    const oldUrl = previousUrl;
    previousUrl = currentUrl;
    onChange(currentUrl, oldUrl);
  };

  const interval = window.setInterval(check, 500);
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);

  return () => {
    window.clearInterval(interval);
    window.removeEventListener("popstate", check);
    window.removeEventListener("hashchange", check);
  };
}
