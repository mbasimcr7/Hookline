import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): { rawKey: string; keyHash: string; prefix: string } {
  const randomPart = randomBytes(24).toString('base64url');
  const rawKey = `whk_${randomPart}`;
  const prefix = rawKey.substring(0, 8);
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyHash, prefix };
}

export function generateEndpointSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * Signs outbound webhook request using HMAC-SHA256
 * Format: v1=<hex_digest>
 */
export function signWebhookPayload(secret: string, timestamp: number, payload: string): string {
  const signaturePayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret).update(signaturePayload).digest('hex');
  return `v1=${hmac}`;
}

/**
 * Constant-time comparison for HMAC verification
 * Checks timestamp freshness (default: 5 minutes)
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  payload: string,
  signatureHeader: string,
  toleranceSeconds = 300
): { valid: boolean; reason?: string } {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside acceptable window' };
  }

  const expectedSignature = signWebhookPayload(secret, timestamp, payload);

  const sigBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }

  const matches = timingSafeEqual(sigBuffer, expectedBuffer);
  return { valid: matches, reason: matches ? undefined : 'Signature does not match' };
}
