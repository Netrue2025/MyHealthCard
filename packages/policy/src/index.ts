import type { Role } from "@netrue/shared";

export type PolicyContext = {
  actorId: string; roles: Role[]; actorPatientId?: string; patientId?: string;
  action: "read" | "write" | "download" | "review" | "export" | "submit" | "admin";
  provider?: { status: "pending" | "verified" | "suspended"; credentialExpiresAt?: Date; mfaVerified: boolean };
  grant?: { recipientId: string; actions: string[]; resourceIds: string[]; expiresAt: Date; revokedAt?: Date | null };
  resourceId?: string; membershipActive?: boolean; now?: Date;
};

export function authorize(context: PolicyContext): { allowed: boolean; reason: string } {
  const now = context.now ?? new Date();
  if (!context.actorId || !context.patientId) return { allowed: false, reason: "missing_context" };
  if (context.roles.includes("patient") && context.actorPatientId === context.patientId) return { allowed: true, reason: "patient_owner" };
  if (context.roles.includes("security_admin") && context.action === "admin") return { allowed: true, reason: "security_admin" };
  if (context.action === "submit" && context.membershipActive) return { allowed: true, reason: "active_facility_membership" };
  const provider = context.provider;
  const grant = context.grant;
  if (!provider || provider.status !== "verified" || !provider.mfaVerified) return { allowed: false, reason: "provider_not_eligible" };
  if (provider.credentialExpiresAt && provider.credentialExpiresAt <= now) return { allowed: false, reason: "credentials_expired" };
  if (!grant || grant.recipientId !== context.actorId || grant.revokedAt || grant.expiresAt <= now) return { allowed: false, reason: "grant_inactive" };
  const needed = context.action === "read" ? "view" : context.action;
  if (!grant.actions.includes(needed)) return { allowed: false, reason: "scope_missing" };
  if (context.resourceId && !grant.resourceIds.includes(context.resourceId)) return { allowed: false, reason: "resource_not_granted" };
  return { allowed: true, reason: "active_named_grant" };
}
