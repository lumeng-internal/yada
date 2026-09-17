/** URL readback works across extension isolated worlds; no React or page bridge. */
export function observeRouteChange(onChange: (url: string, previousUrl: string) => void): () => void {
  let previousUrl = location.href, raf = 0;
  const check = (): void => {
    const currentUrl = location.href;
    if (currentUrl !== previousUrl) { const old = previousUrl; previousUrl = currentUrl; onChange(currentUrl, old); }
  };
  const frame = (): void => { check(); raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
  window.addEventListener('popstate', check); window.addEventListener('hashchange', check);
  return () => { cancelAnimationFrame(raf); window.removeEventListener('popstate', check); window.removeEventListener('hashchange', check); };
}
