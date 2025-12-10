/**
 * Encryption utilities for API keys and secrets
 */

import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || generateDefaultKey();

function generateDefaultKey(): string {
  // Generate a default key if none provided (for development)
  // In production, ENCRYPTION_KEY should always be set
  return 'default-encryption-key-change-in-production-32char';
}

/**
 * Encrypt a string
 */
export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

/**
 * Decrypt a string
 */
export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
