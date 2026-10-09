import { describe, expect, it } from "vitest";
import { authorize } from "./index.js";
const now = new Date("2026-01-01T00:00:00Z");
describe("deny-by-default policy", () => {
  it("allows only the owning patient", () => expect(authorize({actorId:"u1",roles:["patient"],actorPatientId:"p1",patientId:"p1",action:"read",now}).allowed).toBe(true));
  it("denies cross-patient access", () => expect(authorize({actorId:"u1",roles:["patient"],actorPatientId:"p1",patientId:"p2",action:"read",now}).allowed).toBe(false));
  it("denies a suspended provider despite a grant", () => expect(authorize({actorId:"doctor",roles:["practitioner"],patientId:"p1",action:"read",provider:{status:"suspended",mfaVerified:true},grant:{recipientId:"doctor",actions:["view"],resourceIds:["r1"],expiresAt:new Date("2027-01-01")},resourceId:"r1",now}).allowed).toBe(false));
  it("enforces resource and action scope", () => expect(authorize({actorId:"doctor",roles:["practitioner"],patientId:"p1",action:"download",provider:{status:"verified",mfaVerified:true},grant:{recipientId:"doctor",actions:["view"],resourceIds:["r1"],expiresAt:new Date("2027-01-01")},resourceId:"r1",now}).allowed).toBe(false));
});
