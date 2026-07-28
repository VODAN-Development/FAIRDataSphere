import crypto from "crypto";

const SESSION_COOKIE = "sitrep_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_SECRET = "sitrep-dev-secret-change-me";

// Production must provide a stable secret; development gets a default so local
// sign-in works without extra setup.
function secret() {
  const configured = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production.");
  }
  return DEFAULT_SECRET;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

// Session tokens are compact HMAC-signed payloads rather than database sessions.
function sign(payload) {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

export function createSessionToken(user) {
  const payload = base64Url(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  // Recompute the signature before parsing payload content so tampered cookies
  // never reach JSON handling or expiry checks.
  if (sign(payload) !== signature) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function sessionCookieOptions() {
  const secure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    maxAge: SESSION_TTL_MS,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}
