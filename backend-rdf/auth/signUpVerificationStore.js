import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listUsers } from "./authStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const SIGNUP_CODES_FILE = path.join(DATA_DIR, "signup-codes.json");
const CODE_TTL_MS = 1000 * 60 * 10;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim() || null;
}

function validateSignUpInput({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return normalizedEmail;
}

function codeHash(code) {
  return crypto
    .createHash("sha256")
    .update(String(code))
    .digest("hex");
}

function createCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

async function readCodes() {
  try {
    return JSON.parse(await readFile(SIGNUP_CODES_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeCodes(codes) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SIGNUP_CODES_FILE, `${JSON.stringify(codes, null, 2)}\n`, "utf8");
}

function expectedHostnames() {
  return new Set(
    (process.env.TURNSTILE_HOSTNAMES || "")
      .split(",")
      .map(hostname => hostname.trim())
      .filter(Boolean)
  );
}

async function verifyCaptcha(token, remoteIp) {
  const hostnames = expectedHostnames();
  if (!process.env.TURNSTILE_SECRET || hostnames.size === 0) {
    throw new Error("Captcha is not configured.");
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new Error("Please complete the captcha.");
  }

  let result;
  try {
    const params = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET,
      response: token,
    });
    if (remoteIp) params.set("remoteip", remoteIp);

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: params,
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = await response.json();
  } catch {
    throw new Error("Captcha verification failed. Please try again.");
  }

  if (!result.success) {
    console.error("Turnstile validation failed", {
      errorCodes: result["error-codes"] || [],
      hostname: result.hostname || null,
      action: result.action || null,
    });
    throw new Error("Captcha verification failed. Please try again.");
  }

  if (result.action !== "signup") {
    console.error("Turnstile action mismatch", {
      expectedAction: "signup",
      action: result.action || null,
      hostname: result.hostname || null,
    });
    throw new Error("Captcha verification failed. Please try again.");
  }

  if (!hostnames.has(result.hostname)) {
    console.error("Turnstile hostname mismatch", {
      expectedHostnames: Array.from(hostnames),
      hostname: result.hostname || null,
      action: result.action || null,
    });
    throw new Error("Captcha verification failed. Please try again.");
  }
}

function mailTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    throw new Error("Email delivery is not configured.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
  });
}

async function sendCodeEmail(email, code) {
  const appName = process.env.APP_NAME || "FAIR Data Sphere";
  await mailTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: `${appName} account verification code`,
    text: `Your ${appName} verification code is ${code}. It expires in 10 minutes.`,
  });
}

async function ensureEmailIsAvailable(email) {
  const users = await listUsers();
  if (users.some(user => user.email === email)) {
    throw new Error("An account already exists for this email.");
  }
}

export async function requestSignUpCode({ email, password, name, captchaToken, remoteIp }) {
  const normalizedEmail = validateSignUpInput({ email, password });
  await ensureEmailIsAvailable(normalizedEmail);
  await verifyCaptcha(captchaToken, remoteIp);

  const code = createCode();
  const now = new Date();
  await writeCodes([
    ...(await readCodes()).filter(entry => (
      entry.email !== normalizedEmail && Date.parse(entry.expiresAt) > now.getTime()
    )),
    {
      email: normalizedEmail,
      name: normalizeName(name),
      codeHash: codeHash(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    },
  ]);
  await sendCodeEmail(normalizedEmail, code);
  return true;
}

export async function consumeSignUpCode({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  const now = Date.now();
  const codes = await readCodes();
  const entry = codes.find(candidate => candidate.email === normalizedEmail);
  if (!entry || Date.parse(entry.expiresAt) <= now || entry.codeHash !== codeHash(code)) {
    throw new Error("Invalid or expired verification code.");
  }

  await writeCodes(codes.filter(candidate => candidate.email !== normalizedEmail));
  return {
    email: normalizedEmail,
    name: entry.name,
  };
}
