import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loginSchema,
  registerSchema,
  recordSchema,
  historySchema,
  grantSchema,
  observationSchema,
  historyTypes,
  medicationSchema,
  medicationLogSchema,
  dailyTestSchema,
} from "@netrue/shared";
import { evaluateResult } from "@netrue/results";
import { authorize } from "@netrue/policy";
import { db } from "./db.js";
import { audit } from "./audit.js";
import {
  assertCsrf,
  clearSessionCookies,
  createSession,
  hashToken,
  newToken,
  requireUser,
  setSessionCookies,
} from "./security.js";
import { config } from "./config.js";
import { details as placeDetails, geocode, nearby } from "./places.js";
import sharp from "sharp";

const oid = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
const user = (r: FastifyRequest) => (r as any).user as any;
function fail(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string,
) {
  return reply.code(status).send({ code, message, requestId: request.id });
}
function shape(doc: any) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}
async function owner(request: FastifyRequest, reply: FastifyReply) {
  const u = await requireUser(request, reply);
  if (!u || !(u as any).patientId) return null;
  return u as any;
}
async function sanitiseImage(file: any, d: any) {
  if (!file.mime?.startsWith("image/") || file.processingStatus === "available")
    return file;
  const path = join(config.UPLOAD_DIR, file.storageKey);
  const input = await readFile(path);
  const output =
    file.mime === "image/png"
      ? await sharp(input, { failOn: "error" }).rotate().png().toBuffer()
      : await sharp(input, { failOn: "error" })
          .rotate()
          .jpeg({ quality: 92 })
          .toBuffer();
  await writeFile(path, output, { mode: 0o600 });
  await d.collection("files").updateOne(
    { _id: file._id },
    {
      $set: {
        size: output.length,
        checksum: createHash("sha256").update(output).digest("hex"),
        scanStatus: "sanitised",
        processingStatus: "available",
        sanitisedAt: new Date(),
      },
    },
  );
  return {
    ...file,
    size: output.length,
    scanStatus: "sanitised",
    processingStatus: "available",
  };
}
export async function routes(app: FastifyInstance) {
  app.post("/v1/auth/register", async (req, rep) => {
    const input = registerSchema.safeParse(req.body);
    if (!input.success)
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Check the registration details.",
      );
    const d = await db();
    const existing = await d
      .collection("users")
      .findOne({ email: input.data.email.toLowerCase() });
    if (existing)
      return fail(
        rep,
        req,
        409,
        "ACCOUNT_EXISTS",
        "An account already uses this email.",
      );
    const patientId = new ObjectId();
    const healthId = `NTH-${randomBytes(6).toString("hex").toUpperCase()}`;
    await d.collection("patients").insertOne({
      _id: patientId,
      healthId,
      fullName: input.data.fullName,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    const result = await d.collection("users").insertOne({
      email: input.data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.data.password, 12),
      fullName: input.data.fullName,
      roles: ["patient"],
      patientId,
      state: "active",
      emailVerified: true,
      createdAt: new Date(),
    });
    const s = await createSession(result.insertedId);
    setSessionCookies(rep, s.token, s.csrf);
    rep.code(201).send({
      user: {
        id: result.insertedId.toString(),
        email: input.data.email,
        fullName: input.data.fullName,
        roles: ["patient"],
        patientId: patientId.toString(),
        mfaVerified: false,
      },
    });
  });
  app.post("/v1/auth/login", async (req, rep) => {
    const input = loginSchema.safeParse(req.body);
    if (!input.success)
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Check your sign-in details.",
      );
    const d = await db();
    const found = await d
      .collection("users")
      .findOne({ email: input.data.email.toLowerCase(), state: "active" });
    if (
      !found ||
      !(await bcrypt.compare(input.data.password, found.passwordHash))
    )
      return fail(
        rep,
        req,
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    const needsMfa = found.roles.some((r: string) => r !== "patient");
    if (needsMfa && input.data.mfaCode !== "123456")
      return fail(
        rep,
        req,
        401,
        "MFA_REQUIRED",
        "Enter the six-digit verification code. Demo code: 123456",
      );
    const s = await createSession(found._id, needsMfa);
    setSessionCookies(rep, s.token, s.csrf);
    return {
      user: {
        id: found._id.toString(),
        email: found.email,
        fullName: found.fullName,
        roles: found.roles,
        patientId: found.patientId?.toString(),
        practitionerStatus: found.practitionerStatus,
        mfaVerified: needsMfa,
      },
    };
  });
  app.post(
    "/v1/auth/logout",
    { preHandler: [requireUser] },
    async (req, rep) => {
      if (!assertCsrf(req, rep)) return;
      const token = req.cookies.netrue_session;
      if (token) {
        const d = await db();
        await d
          .collection("sessions")
          .deleteOne({ tokenHash: hashToken(token) });
      }
      clearSessionCookies(rep);
      return { ok: true };
    },
  );
  app.post("/v1/auth/reset", async () => ({
    ok: true,
    message: "If an account matches, recovery instructions will be sent.",
  }));
  app.get("/v1/me", async (req, rep) => {
    const u = await requireUser(req, rep);
    if (!u) return;
    return {
      user: u,
      features: {
        resultComparison: config.FEATURE_RESULT_COMPARISON,
        ocr: config.FEATURE_OCR,
        emergencyProfile: config.FEATURE_EMERGENCY_PROFILE,
      },
    };
  });
  app.get("/v1/sessions", { preHandler: [requireUser] }, async (req) => {
    const d = await db();
    return {
      items: (
        await d
          .collection("sessions")
          .find({ userId: new ObjectId(user(req).id) })
          .sort({ createdAt: -1 })
          .toArray()
      ).map((s) => ({
        id: s._id.toString(),
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.tokenHash === hashToken(req.cookies.netrue_session ?? ""),
      })),
    };
  });
  app.delete(
    "/v1/sessions/:id",
    { preHandler: [requireUser] },
    async (req, rep) => {
      if (!assertCsrf(req, rep)) return;
      const id = oid((req.params as any).id);
      if (!id) return fail(rep, req, 404, "NOT_FOUND", "Session not found.");
      const d = await db();
      await d
        .collection("sessions")
        .deleteOne({ _id: id, userId: new ObjectId(user(req).id) });
      return { ok: true };
    },
  );
  app.get("/v1/patients/me", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    return {
      patient: shape(
        await d
          .collection("patients")
          .findOne({ _id: new ObjectId(u.patientId) }),
      ),
    };
  });
  app.patch("/v1/patients/me", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const allowed = [
      "fullName",
      "dateOfBirth",
      "bloodGroup",
      "genotype",
      "city",
      "state",
    ];
    const patch = Object.fromEntries(
      Object.entries((req.body ?? {}) as any).filter(
        ([k, v]) => allowed.includes(k) && typeof v === "string",
      ),
    );
    const d = await db();
    const current = await d
      .collection("patients")
      .findOne({ _id: new ObjectId(u.patientId) });
    const expected = Number(req.headers["if-match"] ?? current?.version);
    if (current?.version !== expected)
      return fail(
        rep,
        req,
        409,
        "VERSION_CONFLICT",
        "This profile changed. Refresh and try again.",
      );
    await d
      .collection("patients")
      .updateOne(
        { _id: current._id, version: expected },
        { $set: { ...patch, updatedAt: new Date() }, $inc: { version: 1 } },
      );
    return {
      patient: shape(
        await d.collection("patients").findOne({ _id: current._id }),
      ),
    };
  });
  app.get("/v1/dashboard", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    const patientId = new ObjectId(u.patientId);
    const [records, grants, history, notifications] = await Promise.all([
      d
        .collection("records")
        .countDocuments({ patientId, status: { $ne: "deleted" } }),
      d.collection("grants").countDocuments({
        patientId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }),
      d.collection("history").countDocuments({ patientId }),
      d
        .collection("notifications")
        .find({ userId: new ObjectId(u.id) })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
    ]);
    return {
      counts: { records, activeShares: grants, history },
      notifications: notifications.map(shape),
    };
  });
  app.get("/v1/records", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const q = req.query as any;
    const filter: any = {
      patientId: new ObjectId(u.patientId),
      status: { $ne: "deleted" },
    };
    if (q.category) filter.category = q.category;
    if (q.search)
      filter.title = {
        $regex: String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    const d = await db();
    return {
      items: (
        await d
          .collection("records")
          .find(filter)
          .sort({ reportDate: -1, createdAt: -1 })
          .limit(Math.min(Number(q.limit) || 20, 100))
          .toArray()
      ).map(shape),
    };
  });
  app.post("/v1/records", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const input = recordSchema.safeParse(req.body);
    if (!input.success)
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Check the record details.",
      );
    const d = await db();
    const now = new Date();
    const result = await d.collection("records").insertOne({
      ...input.data,
      patientId: new ObjectId(u.patientId),
      status: "available",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await d.collection("record_versions").insertOne({
      recordId: result.insertedId,
      patientId: new ObjectId(u.patientId),
      version: 1,
      snapshot: input.data,
      finalisedAt: now,
    });
    await audit({
      actorId: u.id,
      patientId: u.patientId,
      action: "record.create",
      resourceType: "record",
      resourceId: result.insertedId.toString(),
      outcome: "success",
      requestId: req.id,
    });
    return rep.code(201).send({
      record: shape(
        await d.collection("records").findOne({ _id: result.insertedId }),
      ),
    });
  });
  app.get("/v1/records/:id", async (req, rep) => {
    const u = await requireUser(req, rep);
    if (!u) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    const d = await db();
    const record = await d.collection("records").findOne({ _id: id });
    if (!record) return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    const decision = authorize({
      actorId: (u as any).id,
      roles: (u as any).roles,
      actorPatientId: (u as any).patientId,
      patientId: record.patientId.toString(),
      action: "read",
    });
    if (!decision.allowed) {
      await audit({
        actorId: (u as any).id,
        patientId: record.patientId.toString(),
        action: "record.read",
        resourceType: "record",
        resourceId: id.toString(),
        outcome: "denied",
        requestId: req.id,
      });
      return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    }
    const [observations, files] = await Promise.all([
      d
        .collection("observations")
        .find({ recordId: id, patientId: record.patientId })
        .toArray(),
      d
        .collection("files")
        .find({ recordId: id, patientId: record.patientId })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    return {
      record: shape(record),
      observations: observations.map(shape),
      files: files.map((f) => ({
        id: f._id.toString(),
        name: f.originalName,
        mime: f.mime,
        size: f.size,
        scanStatus: f.scanStatus,
        processingStatus: f.processingStatus,
        createdAt: f.createdAt,
      })),
    };
  });
  app.delete("/v1/records/:id", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    const d = await db();
    const result = await d
      .collection("records")
      .updateOne(
        { _id: id, patientId: new ObjectId(u.patientId) },
        { $set: { status: "deleted", deletedAt: new Date() } },
      );
    if (!result.matchedCount)
      return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    return { ok: true };
  });
  app.post("/v1/records/:id/observations", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id);
    const input = observationSchema.safeParse(req.body);
    if (!id || !input.success)
      return fail(rep, req, 400, "VALIDATION_ERROR", "Check the result row.");
    const d = await db();
    if (
      !(await d
        .collection("records")
        .findOne({ _id: id, patientId: new ObjectId(u.patientId) }))
    )
      return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    const evaluation = config.FEATURE_RESULT_COMPARISON
      ? evaluateResult(input.data)
      : {
          status: "grey",
          reason: "feature_disabled",
          wording:
            "Automated comparison is not enabled. View the original report or ask the laboratory.",
        };
    const result = await d.collection("observations").insertOne({
      ...input.data,
      recordId: id,
      patientId: new ObjectId(u.patientId),
      evaluation: {
        ...evaluation,
        ruleVersion: "1.0",
        evaluatedAt: new Date(),
      },
      createdAt: new Date(),
    });
    return rep.code(201).send({
      observation: shape(
        await d.collection("observations").findOne({ _id: result.insertedId }),
      ),
    });
  });
  app.get("/v1/history", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const type = (req.query as any).type;
    const filter: any = { patientId: new ObjectId(u.patientId) };
    if (type && historyTypes.includes(type)) filter.type = type;
    const d = await db();
    return {
      items: (
        await d
          .collection("history")
          .find(filter)
          .sort({ date: -1, createdAt: -1 })
          .limit(100)
          .toArray()
      ).map(shape),
    };
  });
  app.post("/v1/history/:type", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const type = (req.params as any).type;
    if (!historyTypes.includes(type))
      return fail(
        rep,
        req,
        400,
        "INVALID_HISTORY_TYPE",
        "This history category is not supported.",
      );
    const input = historySchema.safeParse(req.body);
    if (!input.success)
      return fail(rep, req, 400, "VALIDATION_ERROR", "Check the history item.");
    const d = await db();
    const result = await d.collection("history").insertOne({
      ...input.data,
      type,
      patientId: new ObjectId(u.patientId),
      source: "self_reported",
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    return rep.code(201).send({
      item: shape(
        await d.collection("history").findOne({ _id: result.insertedId }),
      ),
    });
  });
  app.delete("/v1/history/:id", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "History item not found.");
    const d = await db();
    await d
      .collection("history")
      .deleteOne({ _id: id, patientId: new ObjectId(u.patientId) });
    return { ok: true };
  });
  app.get("/v1/medications", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    const patientId = new ObjectId(u.patientId);
    const today = new Date().toISOString().slice(0, 10);
    const [schedules, logs] = await Promise.all([
      d
        .collection("medication_schedules")
        .find({ patientId, active: true })
        .sort({ createdAt: -1 })
        .toArray(),
      d
        .collection("medication_logs")
        .find({ patientId, scheduledDate: today })
        .toArray(),
    ]);
    return { items: schedules.map(shape), logs: logs.map(shape) };
  });
  app.post("/v1/medications", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const input = medicationSchema.safeParse(req.body);
    if (!input.success)
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Check the medication and reminder details.",
      );
    const d = await db();
    const result = await d.collection("medication_schedules").insertOne({
      ...input.data,
      patientId: new ObjectId(u.patientId),
      userId: new ObjectId(u.id),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return rep.code(201).send({
      item: shape(
        await d
          .collection("medication_schedules")
          .findOne({ _id: result.insertedId }),
      ),
    });
  });
  app.post("/v1/medications/:id/log", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id),
      input = medicationLogSchema.safeParse(req.body);
    if (!id || !input.success)
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Check the medication log.",
      );
    const d = await db();
    if (
      !(await d.collection("medication_schedules").findOne({
        _id: id,
        patientId: new ObjectId(u.patientId),
        active: true,
      }))
    )
      return fail(rep, req, 404, "NOT_FOUND", "Medication not found.");
    await d.collection("medication_logs").updateOne(
      {
        patientId: new ObjectId(u.patientId),
        scheduleId: id,
        scheduledDate: input.data.scheduledDate,
        time: input.data.time,
      },
      { $set: { status: input.data.status, loggedAt: new Date() } },
      { upsert: true },
    );
    return { ok: true };
  });
  app.delete("/v1/medications/:id", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "Medication not found.");
    const d = await db();
    await d
      .collection("medication_schedules")
      .updateOne(
        { _id: id, patientId: new ObjectId(u.patientId) },
        { $set: { active: false, updatedAt: new Date() } },
      );
    return { ok: true };
  });
  app.get("/v1/daily-tests", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    return {
      items: (
        await d
          .collection("daily_tests")
          .find({ patientId: new ObjectId(u.patientId) })
          .sort({ measuredAt: -1 })
          .limit(60)
          .toArray()
      ).map(shape),
    };
  });
  app.post("/v1/daily-tests", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const input = dailyTestSchema.safeParse(req.body);
    if (!input.success)
      return fail(rep, req, 400, "VALIDATION_ERROR", "Check the test result.");
    const d = await db();
    const result = await d.collection("daily_tests").insertOne({
      ...input.data,
      measuredAt: new Date(input.data.measuredAt),
      patientId: new ObjectId(u.patientId),
      createdAt: new Date(),
    });
    return rep.code(201).send({
      item: shape(
        await d.collection("daily_tests").findOne({ _id: result.insertedId }),
      ),
    });
  });
  app.delete("/v1/daily-tests/:id", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "Test result not found.");
    const d = await db();
    await d
      .collection("daily_tests")
      .deleteOne({ _id: id, patientId: new ObjectId(u.patientId) });
    return { ok: true };
  });
  app.get("/v1/push/config", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    return {
      enabled: Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
      publicKey: config.VAPID_PUBLIC_KEY ?? null,
    };
  });
  app.post("/v1/push/subscriptions", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY)
      return fail(
        rep,
        req,
        503,
        "PUSH_NOT_CONFIGURED",
        "Push reminders are not configured on this server.",
      );
    const subscription = (req.body as any)?.subscription;
    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    )
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "The notification subscription is invalid.",
      );
    const d = await db();
    await d.collection("push_subscriptions").updateOne(
      { endpoint: String(subscription.endpoint) },
      {
        $set: {
          userId: new ObjectId(u.id),
          patientId: new ObjectId(u.patientId),
          subscription,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return rep.code(201).send({ ok: true });
  });
  app.post("/v1/grants", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const input = grantSchema.safeParse(req.body);
    if (!input.success)
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Check the sharing details.",
      );
    const d = await db();
    const recipient = await d.collection("users").findOne({
      email: input.data.recipientEmail.toLowerCase(),
      roles: "practitioner",
      practitionerStatus: "verified",
    });
    if (!recipient)
      return fail(
        rep,
        req,
        422,
        "RECIPIENT_NOT_VERIFIED",
        "Choose a verified practitioner account.",
      );
    const ids = input.data.resourceIds.map(oid);
    if (ids.some((x) => !x))
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "One or more records are invalid.",
      );
    if (
      (await d.collection("records").countDocuments({
        _id: { $in: ids as ObjectId[] },
        patientId: new ObjectId(u.patientId),
      })) !== ids.length
    )
      return fail(
        rep,
        req,
        404,
        "NOT_FOUND",
        "One or more records are unavailable.",
      );
    const claim = newToken();
    const result = await d.collection("grants").insertOne({
      patientId: new ObjectId(u.patientId),
      recipientId: recipient._id,
      recipientName: recipient.fullName,
      recipientEmail: recipient.email,
      resourceIds: input.data.resourceIds,
      actions: input.data.actions,
      purpose: input.data.purpose,
      expiresAt: new Date(Date.now() + input.data.durationHours * 3600000),
      revokedAt: null,
      claimTokenHash: hashToken(claim),
      claimedAt: new Date(),
      createdAt: new Date(),
    });
    await audit({
      actorId: u.id,
      patientId: u.patientId,
      action: "grant.create",
      resourceType: "grant",
      resourceId: result.insertedId.toString(),
      outcome: "success",
      requestId: req.id,
    });
    return rep.code(201).send({
      grant: shape(
        await d.collection("grants").findOne({ _id: result.insertedId }),
      ),
      claimToken: claim,
    });
  });
  app.get("/v1/grants", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    return {
      items: (
        await d
          .collection("grants")
          .find({ patientId: new ObjectId(u.patientId) })
          .sort({ createdAt: -1 })
          .toArray()
      ).map(shape),
    };
  });
  app.post("/v1/grants/:id/revoke", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "Share not found.");
    const d = await db();
    const result = await d
      .collection("grants")
      .updateOne(
        { _id: id, patientId: new ObjectId(u.patientId), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    if (!result.matchedCount)
      return fail(rep, req, 404, "NOT_FOUND", "Share not found.");
    await audit({
      actorId: u.id,
      patientId: u.patientId,
      action: "grant.revoke",
      resourceType: "grant",
      resourceId: id.toString(),
      outcome: "success",
      requestId: req.id,
    });
    return { ok: true };
  });
  app.get("/v1/provider/patients", async (req, rep) => {
    const u = await requireUser(req, rep);
    if (!u) return;
    if (
      !(u as any).roles.includes("practitioner") ||
      (u as any).practitionerStatus !== "verified" ||
      !(u as any).mfaVerified
    )
      return fail(
        rep,
        req,
        403,
        "PROVIDER_NOT_ELIGIBLE",
        "Verified credentials and MFA are required.",
      );
    const d = await db();
    const grants = await d
      .collection("grants")
      .find({
        recipientId: new ObjectId((u as any).id),
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .toArray();
    const patientIds = [
      ...new Set(grants.map((g) => g.patientId.toString())),
    ].map((x) => new ObjectId(x));
    const patients = await d
      .collection("patients")
      .find({ _id: { $in: patientIds } })
      .toArray();
    return {
      items: patients.map((p) => ({
        id: p._id.toString(),
        fullName: p.fullName,
        healthId: p.healthId,
        grantCount: grants.filter((g) => g.patientId.equals(p._id)).length,
      })),
    };
  });
  app.get(
    "/v1/facilities/nearby",
    { preHandler: [requireUser] },
    async (req, rep) => {
      const q = req.query as any;
      const lat = Number(q.lat),
        lng = Number(q.lng),
        radius = Math.min(Math.max(Number(q.radius) || 5000, 1000), 25000);
      if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
      )
        return fail(
          rep,
          req,
          400,
          "INVALID_LOCATION",
          "Choose a valid location.",
        );
      try {
        const items = await nearby(lat, lng, String(q.type ?? "all"), radius);
        return {
          items,
          searchLocation: { latitude: lat, longitude: lng },
          radius,
          distanceMethod: "Straight-line distance",
        };
      } catch (error: any) {
        return fail(
          rep,
          req,
          error.statusCode ?? 502,
          error.code ?? "PROVIDER_ERROR",
          error.message,
        );
      }
    },
  );
  app.get(
    "/v1/facilities/search",
    { preHandler: [requireUser] },
    async (req, rep) => {
      const q = req.query as any;
      const query = String(q.location ?? "").trim();
      if (query.length < 2 || query.length > 160)
        return fail(
          rep,
          req,
          400,
          "INVALID_LOCATION",
          "Enter a city, area, landmark or address.",
        );
      try {
        const found = await geocode(query);
        const radius = Math.min(
          Math.max(Number(q.radius) || 5000, 1000),
          25000,
        );
        const items = await nearby(
          found.latitude,
          found.longitude,
          String(q.type ?? "all"),
          radius,
        );
        return {
          items,
          searchLocation: found,
          radius,
          distanceMethod: "Straight-line distance",
        };
      } catch (error: any) {
        return fail(
          rep,
          req,
          error.statusCode ?? 502,
          error.code ?? "PROVIDER_ERROR",
          error.message,
        );
      }
    },
  );
  app.get(
    "/v1/facilities/place/:placeId",
    { preHandler: [requireUser] },
    async (req, rep) => {
      const q = req.query as any;
      try {
        return {
          facility: await placeDetails(
            (req.params as any).placeId,
            Number.isFinite(Number(q.lat))
              ? { lat: Number(q.lat), lng: Number(q.lng) }
              : undefined,
          ),
        };
      } catch (error: any) {
        return fail(
          rep,
          req,
          error.statusCode ?? 502,
          error.code ?? "PROVIDER_ERROR",
          error.message,
        );
      }
    },
  );
  app.get("/v1/facilities", async (req) => {
    const d = await db();
    const q = req.query as any;
    const filter: any = { status: "active" };
    if (q.state)
      filter.state = {
        $regex: `^${String(q.state).replace(/[^a-z ]/gi, "")}$`,
        $options: "i",
      };
    if (q.city)
      filter.city = {
        $regex: String(q.city).replace(/[^a-z ]/gi, ""),
        $options: "i",
      };
    return {
      items: (
        await d.collection("facilities").find(filter).limit(100).toArray()
      ).map(shape),
      distanceMethod:
        "Approximate straight-line distance; not a suitability recommendation.",
    };
  });
  app.get("/v1/favourites", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    return {
      items: (
        await d
          .collection("favourites")
          .find({ patientId: new ObjectId(u.patientId) })
          .sort({ createdAt: -1 })
          .toArray()
      ).map(shape),
    };
  });
  app.post("/v1/favourites", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const body = req.body as any;
    if (
      body?.provider !== "google" ||
      typeof body?.providerPlaceId !== "string" ||
      typeof body?.name !== "string"
    )
      return fail(
        rep,
        req,
        400,
        "VALIDATION_ERROR",
        "Facility details are incomplete.",
      );
    const category = [
      "hospital",
      "laboratory",
      "diagnostic_centre",
      "clinic",
    ].includes(body.category)
      ? body.category
      : "clinic";
    const d = await db();
    await d.collection("favourites").updateOne(
      {
        patientId: new ObjectId(u.patientId),
        provider: "google",
        providerPlaceId: body.providerPlaceId,
      },
      {
        $set: {
          name: String(body.name).slice(0, 160),
          category,
          address:
            typeof body.address === "string"
              ? body.address.slice(0, 300)
              : undefined,
          latitude: Number(body.latitude),
          longitude: Number(body.longitude),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    return rep.code(201).send({ ok: true });
  });
  app.delete("/v1/favourites/provider/:placeId", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const d = await db();
    await d.collection("favourites").deleteOne({
      patientId: new ObjectId(u.patientId),
      providerPlaceId: (req.params as any).placeId,
    });
    return { ok: true };
  });
  app.post("/v1/favourites/:facilityId", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const facilityId = oid((req.params as any).facilityId);
    if (!facilityId)
      return fail(rep, req, 404, "NOT_FOUND", "Facility not found.");
    const d = await db();
    await d
      .collection("favourites")
      .updateOne(
        { patientId: new ObjectId(u.patientId), facilityId },
        { $set: { createdAt: new Date() } },
        { upsert: true },
      );
    return { ok: true };
  });
  app.delete("/v1/favourites/:facilityId", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const facilityId = oid((req.params as any).facilityId);
    if (!facilityId)
      return fail(rep, req, 404, "NOT_FOUND", "Facility not found.");
    const d = await db();
    await d
      .collection("favourites")
      .deleteOne({ patientId: new ObjectId(u.patientId), facilityId });
    return { ok: true };
  });
  app.get("/v1/audit/me", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const d = await db();
    return {
      items: (
        await d
          .collection("audit_events")
          .find({ patientId: u.patientId, outcome: "success" })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray()
      ).map(shape),
    };
  });
  app.post("/v1/exports", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const d = await db();
    const result = await d.collection("export_jobs").insertOne({
      patientId: new ObjectId(u.patientId),
      userId: new ObjectId(u.id),
      status: "ready",
      format: "json+fhir-r4",
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    });
    await audit({
      actorId: u.id,
      patientId: u.patientId,
      action: "export.create",
      resourceType: "export",
      resourceId: result.insertedId.toString(),
      outcome: "success",
      requestId: req.id,
    });
    return rep.code(202).send({
      job: {
        id: result.insertedId.toString(),
        status: "ready",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  });
  app.get("/v1/exports/:id", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "Export not found.");
    const d = await db();
    const job = await d.collection("export_jobs").findOne({
      _id: id,
      patientId: new ObjectId(u.patientId),
      expiresAt: { $gt: new Date() },
    });
    if (!job) return fail(rep, req, 404, "NOT_FOUND", "Export not found.");
    const [patient, records, history, observations] = await Promise.all([
      d.collection("patients").findOne({ _id: new ObjectId(u.patientId) }),
      d
        .collection("records")
        .find({
          patientId: new ObjectId(u.patientId),
          status: { $ne: "deleted" },
        })
        .toArray(),
      d
        .collection("history")
        .find({ patientId: new ObjectId(u.patientId) })
        .toArray(),
      d
        .collection("observations")
        .find({ patientId: new ObjectId(u.patientId) })
        .toArray(),
    ]);
    rep
      .header("cache-control", "no-store")
      .header(
        "content-disposition",
        `attachment; filename=netrue-export-${id}.json`,
      );
    return {
      generatedAt: new Date(),
      patient: shape(patient),
      records: records.map(shape),
      history: history.map(shape),
      observations: observations.map(shape),
      fhir: {
        resourceType: "Bundle",
        type: "collection",
        meta: {
          tag: [{ display: "Partial FHIR R4 mapping; not a certification" }],
        },
        entry: [],
      },
    };
  });
  app.post("/v1/deletion-requests", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const d = await db();
    await d
      .collection("grants")
      .updateMany(
        { patientId: new ObjectId(u.patientId), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    const result = await d.collection("deletion_requests").insertOne({
      patientId: new ObjectId(u.patientId),
      userId: new ObjectId(u.id),
      status: "recovery_period",
      eligiblePurgeAt: new Date(Date.now() + 30 * 86400000),
      createdAt: new Date(),
    });
    return rep.code(202).send({
      request: shape(
        await d
          .collection("deletion_requests")
          .findOne({ _id: result.insertedId }),
      ),
    });
  });
  app.post("/v1/emergency/publish", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    if (!config.FEATURE_EMERGENCY_PROFILE)
      return fail(
        rep,
        req,
        403,
        "FEATURE_DISABLED",
        "Emergency profile publishing is disabled pending release approval.",
      );
    const body = req.body as any;
    if (
      body?.consent !== true ||
      !Array.isArray(body?.fields) ||
      !body.fields.length
    )
      return fail(
        rep,
        req,
        400,
        "CONSENT_REQUIRED",
        "Confirm consent and select fields to publish.",
      );
    const token = newToken();
    const d = await db();
    await d
      .collection("emergency_profiles")
      .updateMany(
        { patientId: new ObjectId(u.patientId), disabledAt: null },
        { $set: { disabledAt: new Date() } },
      );
    await d.collection("emergency_profiles").insertOne({
      patientId: new ObjectId(u.patientId),
      tokenHash: hashToken(token),
      fields: body.fields,
      createdAt: new Date(),
      disabledAt: null,
    });
    return {
      token,
      warning: "Anyone with a copied link can see the selected information.",
    };
  });
  app.get("/v1/emergency/:token", async (req, rep) => {
    rep
      .header("cache-control", "no-store")
      .header("x-robots-tag", "noindex, nofollow")
      .header("referrer-policy", "no-referrer");
    const d = await db();
    const profile = await d.collection("emergency_profiles").findOne({
      tokenHash: hashToken((req.params as any).token),
      disabledAt: null,
    });
    if (!profile)
      return fail(
        rep,
        req,
        404,
        "NOT_FOUND",
        "Emergency profile is unavailable.",
      );
    const patient = await d
      .collection("patients")
      .findOne({ _id: profile.patientId });
    const history = await d
      .collection("history")
      .find({ patientId: profile.patientId, type: { $in: profile.fields } })
      .toArray();
    return {
      name: profile.fields.includes("identity") ? patient?.fullName : undefined,
      updatedAt: profile.createdAt,
      items: history.map((h) => ({
        type: h.type,
        label: h.label,
        state: h.state,
        source: h.source,
        updatedAt: h.updatedAt,
      })),
    };
  });
  app.post("/v1/public-shares", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const body = req.body as any;
    const kind = body?.kind;
    const hours = [1, 24, 168].includes(Number(body?.durationHours))
      ? Number(body.durationHours)
      : 24;
    const d = await db();
    const patientId = new ObjectId(u.patientId);
    const share: any = {
      patientId,
      userId: new ObjectId(u.id),
      kind,
      expiresAt: new Date(Date.now() + hours * 3600000),
      revokedAt: null,
      createdAt: new Date(),
    };
    if (kind === "record") {
      const recordId = oid(String(body?.recordId ?? ""));
      if (
        !recordId ||
        !(await d
          .collection("records")
          .findOne({ _id: recordId, patientId, status: { $ne: "deleted" } }))
      )
        return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
      share.recordId = recordId;
    } else if (kind === "daily_logs") {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(body?.dateFrom) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body?.dateTo) ||
        body.dateFrom > body.dateTo
      )
        return fail(
          rep,
          req,
          400,
          "VALIDATION_ERROR",
          "Choose a valid date range.",
        );
      share.dateFrom = body.dateFrom;
      share.dateTo = body.dateTo;
    } else
      return fail(rep, req, 400, "VALIDATION_ERROR", "Choose what to share.");
    const token = newToken();
    const result = await d
      .collection("public_shares")
      .insertOne({ ...share, tokenHash: hashToken(token) });
    await audit({
      actorId: u.id,
      patientId: u.patientId,
      action: "public_share.create",
      resourceType: "public_share",
      resourceId: result.insertedId.toString(),
      outcome: "success",
      requestId: req.id,
    });
    return rep.code(201).send({
      share: {
        id: result.insertedId.toString(),
        kind,
        expiresAt: share.expiresAt,
      },
      url: `${config.APP_ORIGIN}/public/${token}`,
    });
  });
  app.get("/v1/public/:token", async (req, rep) => {
    rep
      .header("cache-control", "no-store")
      .header("x-robots-tag", "noindex, nofollow")
      .header("referrer-policy", "no-referrer");
    const d = await db();
    const share = await d.collection("public_shares").findOne({
      tokenHash: hashToken((req.params as any).token),
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!share)
      return fail(
        rep,
        req,
        404,
        "SHARE_UNAVAILABLE",
        "This shared link is invalid or has expired.",
      );
    const patient = await d
      .collection("patients")
      .findOne({ _id: share.patientId });
    if (share.kind === "record") {
      const record = await d.collection("records").findOne({
        _id: share.recordId,
        patientId: share.patientId,
        status: { $ne: "deleted" },
      });
      const files = await d
        .collection("files")
        .find({ recordId: share.recordId, patientId: share.patientId })
        .toArray();
      return {
        kind: "record",
        ownerName: patient?.fullName,
        expiresAt: share.expiresAt,
        record: shape(record),
        files: files.map((f) => ({
          id: f._id.toString(),
          name: f.originalName,
          mime: f.mime,
          size: f.size,
          available:
            f.processingStatus === "available" || f.mime.startsWith("image/"),
        })),
      };
    }
    const from = new Date(`${share.dateFrom}T00:00:00.000Z`),
      to = new Date(`${share.dateTo}T23:59:59.999Z`);
    const [tests, logs, schedules] = await Promise.all([
      d
        .collection("daily_tests")
        .find({
          patientId: share.patientId,
          measuredAt: { $gte: from, $lte: to },
        })
        .sort({ measuredAt: -1 })
        .toArray(),
      d
        .collection("medication_logs")
        .find({
          patientId: share.patientId,
          scheduledDate: { $gte: share.dateFrom, $lte: share.dateTo },
        })
        .sort({ scheduledDate: -1, time: -1 })
        .toArray(),
      d
        .collection("medication_schedules")
        .find({ patientId: share.patientId })
        .toArray(),
    ]);
    const names = new Map(
      schedules.map((x) => [x._id.toString(), { name: x.name, dose: x.dose }]),
    );
    return {
      kind: "daily_logs",
      ownerName: patient?.fullName,
      expiresAt: share.expiresAt,
      dateFrom: share.dateFrom,
      dateTo: share.dateTo,
      tests: tests.map(shape),
      medications: logs.map((x) => ({
        ...shape(x),
        ...names.get(x.scheduleId.toString()),
      })),
    };
  });
  app.get("/v1/public/:token/files/:id", async (req, rep) => {
    rep
      .header("cache-control", "no-store")
      .header("x-robots-tag", "noindex, nofollow");
    const d = await db();
    const share = await d.collection("public_shares").findOne({
      tokenHash: hashToken((req.params as any).token),
      kind: "record",
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    const id = oid((req.params as any).id);
    if (!share || !id)
      return fail(rep, req, 404, "NOT_FOUND", "File not found.");
    let file: any = await d.collection("files").findOne({
      _id: id,
      recordId: share.recordId,
      patientId: share.patientId,
    });
    if (!file) return fail(rep, req, 404, "NOT_FOUND", "File not found.");
    if (file.mime.startsWith("image/") && file.processingStatus !== "available")
      try {
        file = await sanitiseImage(file, d);
      } catch (error: any) {
        if (error?.code === "ENOENT")
          return fail(
            rep,
            req,
            410,
            "FILE_STORAGE_MISSING",
            "This file was lost during a server redeployment. Please ask the owner to upload it again.",
          );
        return fail(
          rep,
          req,
          422,
          "INVALID_IMAGE",
          "The uploaded image could not be safely processed.",
        );
      }
    if (
      !["clean", "sanitised"].includes(file.scanStatus) ||
      file.processingStatus !== "available"
    )
      return fail(
        rep,
        req,
        423,
        "FILE_PENDING",
        "This file is still being checked.",
      );
    return rep
      .header("content-type", file.mime)
      .header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      )
      .header("x-content-type-options", "nosniff");
    try {
      return rep.send(await readFile(join(config.UPLOAD_DIR, file.storageKey)));
    } catch (error: any) {
      if (error?.code === "ENOENT")
        return fail(
          rep,
          req,
          410,
          "FILE_STORAGE_MISSING",
          "This file was lost during a server redeployment. Please ask the owner to upload it again.",
        );
      throw error;
    }
  });
  app.post("/v1/records/:id/files", async (req, rep) => {
    const u = await owner(req, rep);
    if (!u || !assertCsrf(req, rep)) return;
    const recordId = oid((req.params as any).id);
    if (!recordId) return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    const d = await db();
    if (
      !(await d.collection("records").findOne({
        _id: recordId,
        patientId: new ObjectId(u.patientId),
        status: { $ne: "deleted" },
      }))
    )
      return fail(rep, req, 404, "NOT_FOUND", "Record not found.");
    const file = await req.file({
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    });
    if (!file)
      return fail(
        rep,
        req,
        400,
        "FILE_REQUIRED",
        "Choose a PDF, JPEG or PNG file.",
      );
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.mimetype))
      return fail(
        rep,
        req,
        422,
        "UNSUPPORTED_FILE",
        "Only PDF, JPEG and PNG files are supported.",
      );
    let bytes = await file.toBuffer();
    const signatureOk =
      file.mimetype === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : file.mimetype === "image/png"
          ? bytes.subarray(1, 4).toString() === "PNG"
          : bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!signatureOk)
      return fail(
        rep,
        req,
        422,
        "MIME_MISMATCH",
        "The file contents do not match its type.",
      );
    let scanStatus =
      config.SCANNER_MODE === "development-clean" ? "clean" : "pending";
    if (file.mimetype.startsWith("image/")) {
      try {
        bytes =
          file.mimetype === "image/png"
            ? await sharp(bytes, { failOn: "error" }).rotate().png().toBuffer()
            : await sharp(bytes, { failOn: "error" })
                .rotate()
                .jpeg({ quality: 92 })
                .toBuffer();
        scanStatus = "sanitised";
      } catch (error: any) {
        if (error?.code === "ENOENT")
          return fail(
            rep,
            req,
            410,
            "FILE_STORAGE_MISSING",
            "This file was lost during a server redeployment. Please upload it again.",
          );
        return fail(
          rep,
          req,
          422,
          "INVALID_IMAGE",
          "The image could not be safely processed.",
        );
      }
    }
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    const objectId = new ObjectId();
    await writeFile(join(config.UPLOAD_DIR, objectId.toString()), bytes, {
      mode: 0o600,
    });
    const processingStatus =
      scanStatus === "clean" || scanStatus === "sanitised"
        ? "available"
        : "pending";
    await d.collection("files").insertOne({
      _id: objectId,
      recordId,
      patientId: new ObjectId(u.patientId),
      originalName: file.filename,
      mime: file.mimetype,
      size: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      storageKey: objectId.toString(),
      scanStatus,
      processingStatus,
      createdAt: new Date(),
    });
    await audit({
      actorId: u.id,
      patientId: u.patientId,
      action: "file.upload",
      resourceType: "file",
      resourceId: objectId.toString(),
      outcome: "success",
      requestId: req.id,
    });
    return rep.code(202).send({
      file: {
        id: objectId.toString(),
        name: file.filename,
        mime: file.mimetype,
        size: bytes.length,
        scanStatus,
        processingStatus,
      },
    });
  });
  app.get("/v1/files/:id/content", async (req, rep) => {
    const u = await requireUser(req, rep);
    if (!u) return;
    const id = oid((req.params as any).id);
    if (!id) return fail(rep, req, 404, "NOT_FOUND", "File not found.");
    const d = await db();
    let file: any = await d.collection("files").findOne({ _id: id });
    if (!file) return fail(rep, req, 404, "NOT_FOUND", "File not found.");
    const decision = authorize({
      actorId: (u as any).id,
      roles: (u as any).roles,
      actorPatientId: (u as any).patientId,
      patientId: file.patientId.toString(),
      action: "read",
      resourceId: file.recordId?.toString(),
    });
    if (!decision.allowed)
      return fail(rep, req, 404, "NOT_FOUND", "File not found.");
    if (file.mime.startsWith("image/") && file.processingStatus !== "available")
      try {
        file = await sanitiseImage(file, d);
      } catch (error: any) {
        if (error?.code === "ENOENT")
          return fail(
            rep,
            req,
            410,
            "FILE_STORAGE_MISSING",
            "This file was lost during a server redeployment. Please upload it again.",
          );
        return fail(
          rep,
          req,
          422,
          "INVALID_IMAGE",
          "The uploaded image could not be safely processed.",
        );
      }
    if (
      !["clean", "sanitised"].includes(file.scanStatus) ||
      file.processingStatus !== "available"
    )
      return fail(
        rep,
        req,
        423,
        "FILE_PENDING",
        "This file is not available until its safety checks pass.",
      );
    let content: Buffer;
    try {
      content = await readFile(join(config.UPLOAD_DIR, file.storageKey));
    } catch (error: any) {
      if (error?.code === "ENOENT")
        return fail(
          rep,
          req,
          410,
          "FILE_STORAGE_MISSING",
          "This file was lost during a server redeployment. Please upload it again.",
        );
      throw error;
    }
    await audit({
      actorId: (u as any).id,
      patientId: file.patientId.toString(),
      action: "file.preview",
      resourceType: "file",
      resourceId: id.toString(),
      outcome: "success",
      requestId: req.id,
    });
    rep
      .header("cache-control", "no-store")
      .header("content-type", file.mime)
      .header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      )
      .header("x-content-type-options", "nosniff");
    return rep.send(content);
  });
}
