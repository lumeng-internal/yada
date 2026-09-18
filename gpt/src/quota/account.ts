import type { WorkspaceKind } from "../core/types";
import { getChatGptAccountId } from "../conversation/fetchConversation";

export type AccountContext = {
  accountId: string | null;
  workspaceId: string | null;
  workspaceKind: WorkspaceKind;
  accountKey: string;
};

export function readAccountContext(conversationWorkspaceKind?: WorkspaceKind): AccountContext {
  const accountId = getChatGptAccountId();
  const workspace = readWorkspaceFromAccountStore();
  let workspaceKind: WorkspaceKind = workspace.kind;
  if (conversationWorkspaceKind && conversationWorkspaceKind !== "unknown") {
    workspaceKind = conversationWorkspaceKind;
  }
  if (workspaceKind === "unknown" && workspace.kind !== "unknown") workspaceKind = workspace.kind;
  const workspaceId = workspace.id;
  const accountKey = [
    accountId ?? "account-unknown",
    workspaceKind === "work" ? workspaceId ?? "work" : workspaceKind
  ].join(":");
  return { accountId, workspaceId, workspaceKind, accountKey };
}

function readWorkspaceFromAccountStore(): { id: string | null; kind: WorkspaceKind } {
  try {
    const raw = window.localStorage.getItem("_account");
    if (!raw) return { id: null, kind: "unknown" };
    if (/^account-[a-z0-9_-]+$/i.test(raw)) return { id: null, kind: "unknown" };
    const parsed = JSON.parse(raw) as unknown;
    return findWorkspace(parsed);
  } catch {
    return { id: null, kind: "unknown" };
  }
}

function findWorkspace(value: unknown, depth = 0): { id: string | null; kind: WorkspaceKind } {
  if (!value || typeof value !== "object" || depth > 6) return { id: null, kind: "unknown" };
  const record = value as Record<string, unknown>;
  const id = readId(record);
  const kind = readKind(record);
  if (kind !== "unknown" || id) {
    if (kind !== "unknown") return { id, kind };
  }
  for (const nested of Object.values(record)) {
    const found = findWorkspace(nested, depth + 1);
    if (found.kind !== "unknown" || found.id) return found;
  }
  return { id, kind };
}

function readId(record: Record<string, unknown>): string | null {
  for (const key of ["workspaceId", "workspace_id", "orgId", "org_id", "organization_id"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readKind(record: Record<string, unknown>): WorkspaceKind {
  const tokens = [
    record.workspaceType,
    record.workspace_type,
    record.accountType,
    record.account_type,
    record.planType,
    record.plan_type,
    record.structure,
    record.isWorkspace,
    record.is_workspace,
    record.isBusiness,
    record.product
  ].map((value) => typeof value === "string" ? value.toLowerCase() : value);
  if (tokens.includes(true) || tokens.some((value) => typeof value === "string" && /(work|team|business|enterprise|workspace)/.test(value))) {
    return "work";
  }
  if (tokens.some((value) => typeof value === "string" && /(personal|plus|pro|free|consumer)/.test(value))) {
    return "personal";
  }
  return "unknown";
}
