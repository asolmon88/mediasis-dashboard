import { createClient } from "./server";
import crypto from "crypto";

type DatabaseTokenReturn = {
  business_id: string;
  token_encrypted?: string | null;
  expiry?: string | null;
};

type UberKeysRow = {
  business_id: string;
  client_id: string;
  client_secret: string;
};

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const MAX_SAFE_EXPIRY_SECONDS = 2_500_000;

function getKeyFromMaster(masterKey: string): Buffer {
  return crypto.createHash("sha256").update(masterKey).digest();
}

function encryptToken(token: string, masterKey: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKeyFromMaster(masterKey);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

function decryptToken(encryptedToken: string, masterKey: string): string {
  const [ivB64, tagB64, dataB64] = encryptedToken.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted token format");
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

export async function getUberToken(businessId: string): Promise<string> {
  if (!businessId) {
    throw new Error("Business ID is required to fetch Uber token");
  }

  const supabase = await createClient();
  const { data: tokenData, error: tokenDataError } = await supabase
    .schema("mediasis")
    .from("uber_auth_credential")
    .select("business_id, token_encrypted, expiry")
    .eq("business_id", businessId)
    .maybeSingle();

  if (tokenDataError) {
    throw new Error(`Failed to get Uber token from database: ${tokenDataError.message}`);
  }
  const row = tokenData as DatabaseTokenReturn | null;

  if (row?.token_encrypted && row.expiry) {
    const expiryMs = new Date(row.expiry).getTime();
    if (Date.now() < expiryMs - TOKEN_EXPIRY_BUFFER_MS) {
      const masterKey = process.env.UBER_DIRECT_MASTER_KEY;
      if (!masterKey) {
        throw new Error("UBER_DIRECT_MASTER_KEY is not set");
      }
      return decryptToken(row.token_encrypted, masterKey);
    }
  }
  const { data: keysData, error: keysError } = await supabase
    .schema("mediasis")
    .from("uber_keys")
    .select("business_id, client_id, client_secret")
    .eq("business_id", businessId)
    .maybeSingle();

  if (keysError) {
    throw new Error(`Failed to get Uber client credentials: ${keysError.message}`);
  }
  const keys = keysData as UberKeysRow | null;
  if (!keys?.client_id || !keys?.client_secret) {
    throw new Error("Uber client credentials not found");
  }

  const params = new URLSearchParams();
  params.append("client_id", keys.client_id);
  params.append("client_secret", keys.client_secret);
  params.append("grant_type", "client_credentials");
  params.append("scope", "eats.deliveries");

  const authUrl = process.env.NEXT_PUBLIC_UBER_AUTH_URL;
  if (!authUrl) {
    throw new Error("NEXT_PUBLIC_UBER_AUTH_URL is not set");
  }

  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Uber auth failed: ${error}`);
  }

  const authData = await response.json();
  const expiresInSeconds = Number(authData.expires_in) || 0;
  const safeExpirySeconds = Math.min(expiresInSeconds, MAX_SAFE_EXPIRY_SECONDS);
  const expiryMs = Date.now() + safeExpirySeconds * 1000;

  const masterKey = process.env.UBER_DIRECT_MASTER_KEY;
  if (!masterKey) {
    throw new Error("UBER_DIRECT_MASTER_KEY is not set");
  }

  const encryptedToken = encryptToken(authData.access_token, masterKey);
  const expiryTimestamp = new Date(expiryMs);
  const { error: updateError } = await supabase
    .schema("mediasis")
    .from("uber_auth_credential")
    .update({
      token_encrypted: encryptedToken,
      expiry: expiryTimestamp.toISOString(),
    })
    .eq("business_id", businessId);

  if (updateError) {
    throw new Error(`Failed to save Uber token: ${updateError.message}`);
  }

  return authData.access_token;
}
