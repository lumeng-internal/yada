export const ICON_SIZES = [16, 32, 48, 128] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export type RingValues = {
  outer: number;
  middle: number;
  inner: number;
  center: string | null;
};

const COLORS = {
  outer: "#ff375f",
  middle: "#9cd326",
  inner: "#1ad6d0",
  track: "rgba(255,255,255,0.18)"
};

export function remainingToRatio(remaining: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(1, remaining / limit));
}

export function ringGeometry(size: number): Array<{ radius: number; width: number }> {
  const padding = Math.max(1, size * 0.045);
  const outerWidth = Math.max(1.5, size * 0.11);
  const gap = Math.max(0.75, size * 0.045);
  const cx = size / 2;
  const outerRadius = cx - padding - outerWidth / 2;
  const middleWidth = outerWidth * 0.92;
  const innerWidth = outerWidth * 0.84;
  const middleRadius = outerRadius - outerWidth / 2 - gap - middleWidth / 2;
  const innerRadius = middleRadius - middleWidth / 2 - gap - innerWidth / 2;
  return [
    { radius: outerRadius, width: outerWidth },
    { radius: middleRadius, width: middleWidth },
    { radius: innerRadius, width: innerWidth }
  ];
}

export function renderQuotaIcon(size: IconSize, rings: RingValues): ImageData {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas is unavailable");
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  const geometry = ringGeometry(size);
  const values = [rings.outer, rings.middle, rings.inner];
  const colors = [COLORS.outer, COLORS.middle, COLORS.inner];
  geometry.forEach((ring, index) => {
    drawTrack(ctx, cx, cy, ring.radius, ring.width);
    drawArc(ctx, cx, cy, ring.radius, ring.width, colors[index], values[index]);
  });
  if (size >= 32 && rings.center) {
    ctx.fillStyle = "#f5f5f7";
    ctx.font = `600 ${Math.round(size * (rings.center === "?" ? 0.42 : 0.34))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(rings.center, cx, cy + size * 0.02);
  }
  return ctx.getImageData(0, 0, size, size);
}

export function renderQuotaIcons(rings: RingValues): Record<IconSize, ImageData> {
  return {
    16: renderQuotaIcon(16, rings),
    32: renderQuotaIcon(32, rings),
    48: renderQuotaIcon(48, rings),
    128: renderQuotaIcon(128, rings)
  };
}

function drawTrack(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  width: number
): void {
  ctx.beginPath();
  ctx.strokeStyle = COLORS.track;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawArc(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  color: string,
  ratio: number
): void {
  const filled = Math.max(0, Math.min(0.999, ratio));
  if (filled <= 0) return;
  const start = -Math.PI / 2;
  const end = start + filled * Math.PI * 2;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();
}
