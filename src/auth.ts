// Auth: verify Google/Apple ID tokens, issue our own JWT, guard routes.
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export type AuthedRequest = Request & { userId?: string };

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

// --- Verify a Google ID token via Google's tokeninfo endpoint (no extra deps) ---
export async function verifyGoogleIdToken(idToken: string): Promise<{
  email: string;
  name: string;
  picture?: string;
} | null> {
  const acceptedAudiences = (process.env.GOOGLE_CLIENT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const p: any = await r.json();
    // audience check (skip if none configured, for early local dev)
    if (acceptedAudiences.length && !acceptedAudiences.includes(p.aud)) return null;
    if (!p.email) return null;
    return { email: p.email, name: p.name || p.email.split("@")[0], picture: p.picture };
  } catch {
    return null;
  }
}

// --- Verify an Apple ID token (decode + basic checks). For production, verify the
// signature against Apple's public keys. Here we decode and trust the transport (HTTPS)
// for early dev; harden before launch. ---
export async function verifyAppleIdToken(idToken: string): Promise<{
  email: string;
  name: string;
} | null> {
  try {
    const decoded = jwt.decode(idToken) as any;
    if (!decoded) return null;
    const appleClientId = process.env.APPLE_CLIENT_ID;
    if (appleClientId && decoded.aud !== appleClientId) return null;
    const email = decoded.email || `${decoded.sub}@privaterelay.appleid.com`;
    return { email, name: email.split("@")[0] };
  } catch {
    return null;
  }
}
