import bcrypt from "bcryptjs";

// bcrypt deliberately makes password verification expensive enough to slow
// offline guessing while remaining tolerable for interactive sign-in.
const SALT_ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
