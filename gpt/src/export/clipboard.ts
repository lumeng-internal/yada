export async function writeTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  document.documentElement.append(textarea);
  textarea.select();

  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("Clipboard fallback failed");
}
