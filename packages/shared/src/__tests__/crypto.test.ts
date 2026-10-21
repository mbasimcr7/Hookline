import { describe, it, expect } from 'vitest';
import {
  hashApiKey,
  generateApiKey,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../crypto.js';

describe('Crypto & HMAC Security', () => {
  it('should generate valid API key structure with SHA-256 hash', () => {
    const keyData = generateApiKey();
    expect(keyData.rawKey).toMatch(/^whk_[A-Za-z0-9_-]+/);
    expect(keyData.prefix).toBe(keyData.rawKey.substring(0, 8));
    expect(keyData.keyHash).toBe(hashApiKey(keyData.rawKey));
    expect(keyData.keyHash).toHaveLength(64); // SHA-256 hex length
  });

  it('should generate reproducible and valid HMAC-SHA256 signatures', () => {
    const secret = 'whsec_test_secret_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ event: 'test', amount: 100 });

    const sig1 = signWebhookPayload(secret, timestamp, payload);
    const sig2 = signWebhookPayload(secret, timestamp, payload);

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^v1=[a-f0-9]{64}$/);
  });

  it('should verify valid HMAC signature within tolerance', () => {
    const secret = 'whsec_test_secret_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ hello: 'world' });
    const signature = signWebhookPayload(secret, timestamp, payload);

    const result = verifyWebhookSignature(secret, timestamp, payload, signature, 300);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should reject tampered payload', () => {
    const secret = 'whsec_test_secret_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ original: true });
    const signature = signWebhookPayload(secret, timestamp, payload);

    const tamperedPayload = JSON.stringify({ original: false });
    const result = verifyWebhookSignature(secret, timestamp, tamperedPayload, signature, 300);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature does not match');
  });

  it('should reject expired timestamps (replay attack prevention)', () => {
    const secret = 'whsec_test_secret_123';
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const payload = JSON.stringify({ test: 'replay' });
    const signature = signWebhookPayload(secret, expiredTimestamp, payload);

    const result = verifyWebhookSignature(secret, expiredTimestamp, payload, signature, 300); // 5 min tolerance
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Timestamp outside acceptable window');
  });
});
