import crypto from "node:crypto";

const PREFIX = "enc:v1:";

// Credential keys are separate from field encryption so repository passwords and
// join passwords can be rotated independently.
function credentialKey(envName) {
  const configured = process.env[envName];
  if (!configured) {
    throw new Error(`${envName} must be set.`);
  }

  const raw = Buffer.from(configured, "base64");
  if (raw.length !== 32) {
    throw new Error(`${envName} must be a base64-encoded 32-byte key.`);
  }

  return raw;
}

function isEncryptedValue(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function encryptCredential(value, envName) {
  // Existing encrypted values are left alone to avoid double-encrypting metadata
  // during read/upgrade/write cycles.
  if (value === null || value === undefined || value === "" || isEncryptedValue(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(envName), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

function decryptCredential(value, envName) {
  if (!isEncryptedValue(value)) return value;
  // Stored payload layout is iv || authTag || ciphertext, encoded as base64url.
  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", credentialKey(envName), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptRepositoryPassword(value) {
  return encryptCredential(value, "REPOSITORY_PASSWORD_ENCRYPTION_KEY");
}

export function decryptRepositoryPassword(value) {
  return decryptCredential(value, "REPOSITORY_PASSWORD_ENCRYPTION_KEY");
}

export function encryptJoinPassword(value) {
  return encryptCredential(value, "JOIN_PASSWORD_ENCRYPTION_KEY");
}

export function decryptJoinPassword(value) {
  return decryptCredential(value, "JOIN_PASSWORD_ENCRYPTION_KEY");
}
