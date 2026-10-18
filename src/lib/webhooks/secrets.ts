import crypto from "crypto";

const SECRET_PREFIX = "whsec_";

function getKeyFromMaster(masterKey: string): Buffer {
  return crypto.createHash("sha256").update(masterKey).digest();
}

export function generateWebhookSecret() {
  return `${SECRET_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function encryptWebhookSecret(secret: string, masterKey: string) {
  const iv = crypto.randomBytes(12);
  const key = getKeyFromMaster(masterKey);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

export function decryptWebhookSecret(encryptedSecret: string, masterKey: string) {
  const [ivB64, tagB64, dataB64] = encryptedSecret.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted webhook secret format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const key = getKeyFromMaster(masterKey);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  return decrypted.toString("utf8");
}
