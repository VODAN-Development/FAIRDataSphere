import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { hashPassword, verifyPassword } from "./passwords.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// Only expose non-sensitive account fields to GraphQL callers and session code.
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    role: user.role || "user",
  };
}

// Users are stored in a simple JSON file; missing files mean a fresh install.
async function readUsers() {
  try {
    const json = await readFile(USERS_FILE, "utf8");
    return JSON.parse(json);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Writes are centralised so the data directory is created before first use and
// the on-disk JSON stays human-readable for small deployments.
async function writeUsers(users) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, "utf8");
}

export async function findUserById(id) {
  const users = await readUsers();
  return publicUser(users.find(user => user.id === id));
}

export async function listUsersByIds(ids) {
  const idSet = new Set(ids);
  const users = await readUsers();
  return users
    .filter(user => idSet.has(user.id))
    .map(publicUser);
}

export async function createUser({ email, password, name }) {
  // Normalize email before uniqueness checks so casing cannot create duplicates.
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const users = await readUsers();
  if (users.some(user => user.email === normalizedEmail)) {
    throw new Error("An account already exists for this email.");
  }

  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    name: String(name || "").trim() || null,
    // The first registered account becomes the admin account.
    role: users.length === 0 ? "admin" : "user",
    createdAt: now,
    updatedAt: now,
  };

  await writeUsers([...users, user]);
  return publicUser(user);
}

export async function authenticateUser({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const users = await readUsers();
  const user = users.find(candidate => candidate.email === normalizedEmail);
  if (!user || !(await verifyPassword(password || "", user.passwordHash))) {
    throw new Error("Invalid email or password.");
  }
  return publicUser(user);
}

export async function updateUserProfile(userId, { email, name }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  const users = await readUsers();
  const userIndex = users.findIndex(user => user.id === userId);
  if (userIndex === -1) {
    throw new Error("User not found.");
  }
  if (users.some(user => user.id !== userId && user.email === normalizedEmail)) {
    throw new Error("An account already exists for this email.");
  }

  const nextUser = {
    ...users[userIndex],
    email: normalizedEmail,
    name: String(name || "").trim() || null,
    updatedAt: new Date().toISOString(),
  };
  const nextUsers = [...users];
  nextUsers[userIndex] = nextUser;
  await writeUsers(nextUsers);
  return publicUser(nextUser);
}

export async function updateUserPassword(userId, { currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  // Require the current password even for authenticated sessions to reduce the
  // impact of an unattended browser session.
  const users = await readUsers();
  const userIndex = users.findIndex(user => user.id === userId);
  if (userIndex === -1) {
    throw new Error("User not found.");
  }

  const user = users[userIndex];
  if (!(await verifyPassword(currentPassword || "", user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }

  const nextUser = {
    ...user,
    passwordHash: await hashPassword(newPassword),
    updatedAt: new Date().toISOString(),
  };
  const nextUsers = [...users];
  nextUsers[userIndex] = nextUser;
  await writeUsers(nextUsers);
  return publicUser(nextUser);
}
