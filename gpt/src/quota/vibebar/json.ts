/**
 * Upstream: AstroQore/vibe-bar
 * Upstream file: Sources/VibeBarCore/Adapters/ChatGPTChatParser.swift
 * Commit: af26391c5bcc074108072af8f2807fc4c47edf21
 * License: AGPL-3.0
 * Port: Swift → TypeScript for ChatGPT Yada
 */

export type JsonObject = Record<string, unknown>;

const VALID_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ChatGPT Chat response exceeds the read bound or is not an object.");
  }
  return value as JsonObject;
}

export function parseDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function validModel(value: string): boolean {
  return VALID_MODEL.test(value);
}

export function parseInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
  return value;
}
