/**
 * SVG grid and dynamic panel-color port:
 * - Upstream: https://github.com/uiwjs/react-heat-map
 * - Tag / commit: v2.3.4 / 8eb45dff2ec5ce0d317a9094e42afbdb44c10f92
 * - Files: core/src/SVG.tsx, Day.tsx, Rect.tsx, utils.ts, style/index.less
 * - License: MIT, Copyright (c) 2021 uiw
 * - Adaptation: React elements became direct SVG DOM; 11px cells were fitted to
 *   Yada's 312px popover at 8px while retaining the upstream 2px gutter,
 *   grouped rect grid, dynamic maximum thresholds, and hover stroke contract.
 *
 * Rolling-hour layout and shared tooltip port:
 * - Upstream: https://github.com/wa0x6e/cal-heatmap
 * - Tag / commit: 4.2.4 / 815d7440acb40e91f0907f82267d5b8b4dd8ac76
 * - Files: src/templates/hour.ts, src/templates/day.ts,
 *   src/subDomain/SubDomainPainter.ts, src/plugins/Tooltip.ts,
 *   src/cal-heatmap.scss
 * - License: MIT, Copyright (c) 2012 Tyler Kellen, contributors
 * - Adaptation: fixed row-major rolling hours, one delegated tooltip, native
 *   viewport clamping, Yada theme variables, and no D3/Popper/dayjs runtime.
 */

import { HOUR_MS } from "../quota/heatmap";
import type { QuotaHeatmapBucket } from "../quota/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const AXIS_HEIGHT = 16;
const ROW_LABEL_WIDTH = 32;
const AXIS_COLUMNS = [0, 6, 12, 18, 23] as const;
const PANEL_COLORS = [
  "var(--yada-heatmap-empty)",
  "var(--yada-heatmap-level-1)",
  "var(--yada-heatmap-level-2)",
  "var(--yada-heatmap-level-3)",
  "var(--yada-heatmap-level-4)"
] as const;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export const HEATMAP_CELL_SIZE = 8;
export const HEATMAP_GAP = 2;
export const HEATMAP_RADIUS = 2;

export const QUOTA_HEATMAP_CSS = `
  :host {
    --yada-heatmap-empty: #ebedf0;
    --yada-heatmap-level-1: #c6e48b;
    --yada-heatmap-level-2: #7bc96f;
    --yada-heatmap-level-3: #239a3b;
    --yada-heatmap-level-4: #196127;
    --yada-heatmap-hover: rgba(0, 0, 0, 0.34);
    --yada-tooltip-bg: #222;
    --yada-tooltip-text: #f2f2f2;
  }
  :host([data-yada-theme="dark"]) {
    --yada-heatmap-empty: #2d333b;
    --yada-heatmap-level-1: #0e4429;
    --yada-heatmap-level-2: #006d32;
    --yada-heatmap-level-3: #26a641;
    --yada-heatmap-level-4: #39d353;
    --yada-heatmap-hover: #8c959f;
    --yada-tooltip-bg: #636e7b;
    --yada-tooltip-text: #f0f3f6;
  }
  [data-quota-heatmap] {
    display: block;
    width: 100%;
    margin-top: 6px;
    overflow: hidden;
  }
  [data-quota-heatmap] svg {
    display: block;
    max-width: 100%;
    overflow: visible;
    color: var(--yada-muted);
    font: 8px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none;
  }
  [data-heatmap-axis], [data-heatmap-row-label] {
    fill: currentColor;
    pointer-events: none;
  }
  [data-heatmap-cell] {
    cursor: pointer;
  }
  [data-heatmap-cell]:hover {
    stroke: var(--yada-heatmap-hover);
    stroke-width: 1px;
  }
  [data-heatmap-tooltip] {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    padding: 5px 8px;
    border-radius: 4px;
    background: var(--yada-tooltip-bg);
    color: var(--yada-tooltip-text);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.24);
    font: 11px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    pointer-events: none;
    white-space: nowrap;
  }
  [data-heatmap-tooltip][hidden] { display: none !important; }
`;

export class QuotaHeatmapRenderer {
  private readonly tooltip: HTMLDivElement;
  private readonly rendered: HTMLElement[] = [];
  private listening = false;

  constructor(private readonly eventRoot: HTMLElement) {
    this.tooltip = document.createElement("div");
    this.tooltip.dataset.heatmapTooltip = "true";
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.hidden = true;
    this.eventRoot.append(this.tooltip);
    this.eventRoot.addEventListener("pointerover", this.onPointerOver);
    this.eventRoot.addEventListener("pointerout", this.onPointerOut);
    this.listening = true;
  }

  render(bucket: QuotaHeatmapBucket, container: HTMLElement): void {
    const heatmap = document.createElement("div");
    heatmap.dataset.quotaHeatmap = bucket.id;
    heatmap.append(renderSvg(bucket));
    container.append(heatmap);
    this.rendered.push(heatmap);
  }

  dispose(): void {
    if (this.listening) {
      this.eventRoot.removeEventListener("pointerover", this.onPointerOver);
      this.eventRoot.removeEventListener("pointerout", this.onPointerOut);
      this.listening = false;
    }
    for (const node of this.rendered) node.remove();
    this.rendered.length = 0;
    this.tooltip.remove();
  }

  private readonly onPointerOver = (event: PointerEvent): void => {
    const cell = heatmapCell(event.target);
    if (!cell) return;
    const usageHourStart = Number(cell.dataset.usageHourStart);
    const count = Number(cell.dataset.count);
    if (!Number.isFinite(usageHourStart) || !Number.isFinite(count)) return;
    this.tooltip.textContent = formatQuotaHeatmapTooltip(usageHourStart, count);
    this.tooltip.hidden = false;
    placeTooltip(this.tooltip, cell.getBoundingClientRect());
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (!heatmapCell(event.target)) return;
    this.tooltip.hidden = true;
  };
}

export function formatQuotaHeatmapTooltip(usageHourStart: number, count: number): string {
  const date = new Date(usageHourStart);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]} ${pad2(date.getHours())}:00 使用${count}次`;
}

function renderSvg(bucket: QuotaHeatmapBucket): SVGSVGElement {
  const stride = HEATMAP_CELL_SIZE + HEATMAP_GAP;
  const gridWidth = bucket.columns * HEATMAP_CELL_SIZE + (bucket.columns - 1) * HEATMAP_GAP;
  const gridHeight = bucket.rows * HEATMAP_CELL_SIZE + (bucket.rows - 1) * HEATMAP_GAP;
  const width = ROW_LABEL_WIDTH + gridWidth;
  const height = AXIS_HEIGHT + gridHeight;
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${bucket.windowHours} 小时滚动使用热力图`);

  for (const column of AXIS_COLUMNS) {
    const releaseHour = new Date(bucket.firstReleaseHour + column * HOUR_MS).getHours();
    const label = svgElement("text");
    label.dataset.heatmapAxis = "true";
    label.dataset.heatmapColumn = String(column);
    label.setAttribute("x", String(ROW_LABEL_WIDTH + column * stride + HEATMAP_CELL_SIZE / 2));
    label.setAttribute("y", "8");
    label.setAttribute("text-anchor", "middle");
    label.textContent = pad2(releaseHour);
    svg.append(label);
  }

  const grid = svgElement("g");
  grid.setAttribute("transform", `translate(${ROW_LABEL_WIDTH}, ${AXIS_HEIGHT})`);
  for (let row = 0; row < bucket.rows; row += 1) {
    const labelDate = new Date(bucket.rows === 7
      ? bucket.cells[(row + 1) * bucket.columns - 1]?.usageHourStart ?? bucket.firstReleaseHour + row * 24 * HOUR_MS
      : bucket.firstReleaseHour + row * 24 * HOUR_MS);
    const rowLabel = svgElement("text");
    rowLabel.dataset.heatmapRowLabel = "true";
    rowLabel.setAttribute("x", String(-HEATMAP_GAP));
    rowLabel.setAttribute("y", String(row * stride + HEATMAP_CELL_SIZE - 1));
    rowLabel.setAttribute("text-anchor", "end");
    rowLabel.textContent = `${pad2(labelDate.getMonth() + 1)}/${pad2(labelDate.getDate())}`;
    grid.append(rowLabel);

    const rowGroup = svgElement("g");
    rowGroup.dataset.heatmapRow = String(row);
    for (let column = 0; column < bucket.columns; column += 1) {
      const index = row * bucket.columns + column;
      const cell = bucket.cells[index];
      if (!cell) continue;
      const rect = svgElement("rect");
      rect.dataset.heatmapCell = "true";
      rect.dataset.heatmapIndex = String(index);
      rect.dataset.heatmapRow = String(row);
      rect.dataset.heatmapColumn = String(column);
      rect.dataset.releaseHourStart = String(cell.releaseHourStart);
      rect.dataset.usageHourStart = String(cell.usageHourStart);
      rect.dataset.count = String(cell.count);
      rect.setAttribute("x", String(column * stride));
      rect.setAttribute("y", String(row * stride));
      rect.setAttribute("width", String(HEATMAP_CELL_SIZE));
      rect.setAttribute("height", String(HEATMAP_CELL_SIZE));
      rect.setAttribute("rx", String(HEATMAP_RADIUS));
      rect.setAttribute("ry", String(HEATMAP_RADIUS));
      rect.setAttribute("fill", panelColor(cell.count, bucket.maxCount));
      rect.setAttribute("aria-label", formatQuotaHeatmapTooltip(cell.usageHourStart, cell.count));
      rowGroup.append(rect);
    }
    grid.append(rowGroup);
  }
  svg.append(grid);
  return svg;
}

function panelColor(count: number, maxCount: number): string {
  if (count <= 0 || maxCount <= 0) return PANEL_COLORS[0];
  const step = Math.max(1, Math.ceil(maxCount / (PANEL_COLORS.length - 1)));
  let color: string = PANEL_COLORS[1];
  for (let level = 1; level < PANEL_COLORS.length; level += 1) {
    const threshold = level * step;
    color = PANEL_COLORS[level];
    if (threshold > count) break;
  }
  return color;
}

function placeTooltip(tooltip: HTMLElement, cellRect: DOMRect): void {
  const gutter = 8;
  const offset = 6;
  const tooltipRect = tooltip.getBoundingClientRect();
  const maximumLeft = Math.max(gutter, window.innerWidth - gutter - tooltipRect.width);
  const left = clamp(cellRect.left + (cellRect.width - tooltipRect.width) / 2, gutter, maximumLeft);
  const above = cellRect.top - tooltipRect.height - offset;
  const below = cellRect.bottom + offset;
  const maximumTop = Math.max(gutter, window.innerHeight - gutter - tooltipRect.height);
  const top = clamp(above >= gutter ? above : below, gutter, maximumTop);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function heatmapCell(target: EventTarget | null): SVGRectElement | null {
  return target instanceof Element
    ? target.closest<SVGRectElement>("[data-heatmap-cell]")
    : null;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
