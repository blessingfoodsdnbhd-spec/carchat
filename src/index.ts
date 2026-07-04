// carchat backend — Express + Prisma. Implements the API surface from BUILD-SPEC §7.
// Auth via Google/Apple ID tokens → our JWT. A /auth/dev route exists for local
// testing before OAuth credentials are set up (disabled when NODE_ENV=production).
import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { prisma } from "./db.js";
import {
  signToken,
  requireAuth,
  verifyGoogleIdToken,
  verifyAppleIdToken,
  type AuthedRequest,
} from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

const ok = (res: express.Response, data: unknown) => res.json(data);
const bad = (res: express.Response, code: number, msg: string) => res.status(code).json({ error: msg });

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------- Auth ----------------
async function upsertUser(email: string, name: string, provider: string, avatarUrl?: string) {
  return prisma.user.upsert({
    where: { email },
    update: { name, avatarUrl },
    create: { email, name, provider, avatarUrl },
  });
}

app.post("/auth/google", async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) return bad(res, 400, "idToken required");
  const info = await verifyGoogleIdToken(idToken);
  if (!info) return bad(res, 401, "invalid Google token");
  const user = await upsertUser(info.email, info.name, "google", info.picture);
  ok(res, { token: signToken(user.id), user });
});

app.post("/auth/apple", async (req, res) => {
  const { idToken } = req.body ?? {};
  if (!idToken) return bad(res, 400, "idToken required");
  const info = await verifyAppleIdToken(idToken);
  if (!info) return bad(res, 401, "invalid Apple token");
  const user = await upsertUser(info.email, info.name, "apple");
  ok(res, { token: signToken(user.id), user });
});

// Dev-only quick login (no OAuth). Guarded off in production.
app.post("/auth/dev", async (req, res) => {
  if (process.env.NODE_ENV === "production") return bad(res, 403, "disabled");
  const email = (req.body?.email as string) || "aisyah@example.com";
  const name = (req.body?.name as string) || "Aisyah Rahman";
  const user = await upsertUser(email, name, "google");
  ok(res, { token: signToken(user.id), user });
});

app.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  ok(res, { user });
});

// ---------------- Vehicles ----------------
app.get("/vehicles/me", requireAuth, async (req: AuthedRequest, res) => {
  const vehicles = await prisma.vehicle.findMany({ where: { userId: req.userId } });
  ok(res, { vehicles });
});

app.post("/vehicles", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ plate: z.string().min(2), make: z.string().optional(), model: z.string().optional(), trim: z.string().optional(), allowContact: z.boolean().optional() });
  const p = schema.safeParse(req.body);
  if (!p.success) return bad(res, 400, "invalid body");
  const vehicle = await prisma.vehicle.create({ data: { ...p.data, userId: req.userId! } });
  ok(res, { vehicle });
});

app.patch("/vehicles/:id", requireAuth, async (req: AuthedRequest, res) => {
  const { allowContact } = req.body ?? {};
  const vehicle = await prisma.vehicle.update({ where: { id: String(req.params.id) }, data: { allowContact: !!allowContact } });
  ok(res, { vehicle });
});

// ---------------- Reach: send a private message to a plate ----------------
app.post("/messages/plate", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ plate: z.string().min(2), text: z.string().min(1) });
  const p = schema.safeParse(req.body);
  if (!p.success) return bad(res, 400, "invalid body");
  const plate = p.data.plate.toUpperCase();
  // silent match: find a vehicle with this plate that allows contact
  const vehicle = await prisma.vehicle.findUnique({ where: { plate } });
  const targetUserId = vehicle?.allowContact ? vehicle.userId : undefined;
  await prisma.plateRequest.create({
    data: { fromUserId: req.userId!, targetPlate: plate, targetUserId, body: p.data.text, status: "sent" },
  });
  // NEVER reveal whether the owner exists / allows contact — always the same response.
  ok(res, { delivered: true });
});

app.get("/requests/inbox", requireAuth, async (req: AuthedRequest, res) => {
  const requests = await prisma.plateRequest.findMany({
    where: { targetUserId: req.userId, status: "sent" },
    orderBy: { createdAt: "desc" },
  });
  ok(res, { requests });
});

app.post("/requests/:id/accept", requireAuth, async (req: AuthedRequest, res) => {
  const reqRow = await prisma.plateRequest.findUnique({ where: { id: String(req.params.id) } });
  if (!reqRow || reqRow.targetUserId !== req.userId) return bad(res, 404, "not found");
  const convo = await prisma.conversation.create({
    data: { type: "plate", aUserId: reqRow.fromUserId, bUserId: req.userId, anonymous: true, lastMsg: reqRow.body, lastAt: new Date() },
  });
  await prisma.message.create({ data: { conversationId: convo.id, senderId: reqRow.fromUserId, body: reqRow.body } });
  await prisma.plateRequest.update({ where: { id: reqRow.id }, data: { status: "accepted" } });
  ok(res, { conversation: convo });
});

app.post("/requests/:id/ignore", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.plateRequest.update({ where: { id: String(req.params.id) }, data: { status: "ignored" } });
  ok(res, { ignored: true });
});

// ---------------- Conversations / Messages ----------------
app.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { OR: [{ aUserId: req.userId }, { bUserId: req.userId }] },
    orderBy: { lastAt: "desc" },
  });
  ok(res, { conversations });
});

app.get("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const messages = await prisma.message.findMany({ where: { conversationId: String(req.params.id) }, orderBy: { createdAt: "asc" } });
  ok(res, { messages });
});

app.post("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ body: z.string().min(1), kind: z.string().optional() });
  const p = schema.safeParse(req.body);
  if (!p.success) return bad(res, 400, "invalid body");
  const message = await prisma.message.create({
    data: { conversationId: String(req.params.id), senderId: req.userId!, body: p.data.body, kind: p.data.kind || "text" },
  });
  await prisma.conversation.update({ where: { id: String(req.params.id) }, data: { lastMsg: p.data.body, lastAt: new Date() } });
  ok(res, { message });
});

// ---------------- Merchants / Services ----------------
app.get("/merchants", async (req, res) => {
  const cat = req.query.cat as string | undefined;
  const merchants = await prisma.merchant.findMany({ where: cat ? { category: cat } : undefined });
  ok(res, { merchants });
});

app.get("/merchants/:id", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({ where: { id: String(req.params.id) }, include: { services: true } });
  if (!merchant) return bad(res, 404, "not found");
  ok(res, { merchant });
});

// ---------------- Bookings ----------------
app.get("/bookings", requireAuth, async (req: AuthedRequest, res) => {
  const bookings = await prisma.booking.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" }, include: { merchant: true } });
  ok(res, { bookings });
});

app.post("/bookings", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ merchantId: z.string(), serviceId: z.string().optional(), plate: z.string(), scheduledAt: z.string(), price: z.string() });
  const p = schema.safeParse(req.body);
  if (!p.success) return bad(res, 400, "invalid body");
  const booking = await prisma.booking.create({ data: { ...p.data, userId: req.userId!, status: "requested" } });
  ok(res, { booking });
});

for (const [action, status] of [["confirm", "confirmed"], ["reject", "cancelled"], ["complete", "completed"]] as const) {
  app.post(`/bookings/:id/${action}`, requireAuth, async (req: AuthedRequest, res) => {
    const booking = await prisma.booking.update({ where: { id: String(req.params.id) }, data: { status } });
    ok(res, { booking });
  });
}

app.post("/reviews", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ bookingId: z.string(), merchantId: z.string(), rating: z.number().min(1).max(5), body: z.string().optional() });
  const p = schema.safeParse(req.body);
  if (!p.success) return bad(res, 400, "invalid body");
  const review = await prisma.review.create({ data: { ...p.data, userId: req.userId! } });
  ok(res, { review });
});

// ---------------- Listings (Shop) ----------------
app.get("/listings", async (req, res) => {
  const cat = req.query.cat as string | undefined;
  const listings = await prisma.listing.findMany({ where: cat ? { category: cat } : undefined, orderBy: { createdAt: "desc" } });
  ok(res, { listings });
});

app.post("/listings/:id/enquire", requireAuth, async (req: AuthedRequest, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: String(req.params.id) } });
  if (!listing) return bad(res, 404, "not found");
  const convo = await prisma.conversation.create({
    data: { type: "listing", aUserId: req.userId!, bUserId: listing.sellerUserId, listingId: listing.id, lastMsg: "Enquiry about " + listing.title, lastAt: new Date() },
  });
  ok(res, { conversation: convo });
});

// ---------------- Showcase (Car) ----------------
app.get("/showcase/feed", async (_req, res) => {
  const showcase = await prisma.showcase.findMany({ orderBy: { createdAt: "desc" }, include: { user: true } });
  ok(res, { showcase });
});

app.post("/showcase", requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ photoUrl: z.string().optional(), tag: z.string().optional(), caption: z.string().optional(), vehicleId: z.string().optional() });
  const p = schema.safeParse(req.body);
  if (!p.success) return bad(res, 400, "invalid body");
  const item = await prisma.showcase.create({ data: { ...p.data, userId: req.userId! } });
  ok(res, { showcase: item });
});

app.post("/showcase/:id/like", requireAuth, async (req: AuthedRequest, res) => {
  try {
    await prisma.showcaseLike.create({ data: { userId: req.userId!, showcaseId: String(req.params.id) } });
    await prisma.showcase.update({ where: { id: String(req.params.id) }, data: { likeCount: { increment: 1 } } });
  } catch {
    // already liked — ignore unique violation
  }
  const item = await prisma.showcase.findUnique({ where: { id: String(req.params.id) } });
  ok(res, { showcase: item });
});

// ---------------- Biz (merchant dashboard, same account) ----------------
app.get("/biz/bookings", requireAuth, async (req: AuthedRequest, res) => {
  const merchants = await prisma.merchant.findMany({ where: { ownerUserId: req.userId } });
  const ids = merchants.map((m) => m.id);
  const bookings = await prisma.booking.findMany({ where: { merchantId: { in: ids } }, orderBy: { createdAt: "desc" }, include: { user: true } });
  ok(res, { bookings });
});

app.patch("/biz/status", requireAuth, async (req: AuthedRequest, res) => {
  const { merchantId, isOpen } = req.body ?? {};
  const merchant = await prisma.merchant.update({ where: { id: merchantId }, data: { isOpen: !!isOpen } });
  ok(res, { merchant });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`carchat backend on http://localhost:${PORT}`));
