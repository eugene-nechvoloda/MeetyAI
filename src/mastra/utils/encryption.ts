/**
 * Encryption Utility
 * 
 * Handles encryption and decryption of sensitive data (API keys, credentials)
 * Uses AES-256-GCM for encryption
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Gets or creates encryption key from environment
 * In production, this should be stored securely (e.g., in secrets management)
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  
  if (!keyHex) {
    throw new Error("ENCRYPTION_KEY or SESSION_SECRET environment variable required for encryption");
  }

  // Use first 32 bytes of the key
  const key = crypto
    .createHash("sha256")
    .update(keyHex)
    .digest();

  return key.subarray(0, KEY_LENGTH);
}

/**
 * Encrypts a string value
 * Returns base64-encoded string: iv:authTag:encrypted
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return "";
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:encrypted (all in hex)
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Decrypts an encrypted string
 * Expects format: iv:authTag:encrypted (all in hex)
 */
export function decrypt(encryptedData: string): string {
  if (!encryptedData) {
    return "";
  }

  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(":");
    
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Masks an API key for display (shows only last 4 characters)
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 4) {
    return "****";
  }
  
  const visibleChars = 4;
  const masked = "*".repeat(Math.max(0, apiKey.length - visibleChars));
  const visible = apiKey.slice(-visibleChars);
  
  return `${masked}${visible}`;
}

/**
 * Validates encryption key is available
 */
export function validateEncryptionKey(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
