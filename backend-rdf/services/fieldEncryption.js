import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function encryptionKey() {
  const configured = process.env.FIELD_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error("FIELD_ENCRYPTION_KEY must be set.");
  }

  const raw = Buffer.from(configured, "base64");
  if (raw.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return raw;
}

function isEncryptedValue(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptFieldValue(value) {
  if (value === null || value === undefined || value === "" || isEncryptedValue(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

export function decryptFieldValue(value) {
  if (!isEncryptedValue(value)) return value;
  const payload = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function decryptFieldValueSafe(value) {
  try {
    return decryptFieldValue(value);
  } catch {
    return "[Unable to decrypt]";
  }
}
