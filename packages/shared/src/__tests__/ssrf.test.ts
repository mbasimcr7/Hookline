import { describe, it, expect } from 'vitest';
import { validateEndpointUrl } from '../ssrf.js';

describe('SSRF Protection', () => {
  it('should accept valid public HTTPS URLs', async () => {
    const valid = await validateEndpointUrl('https://example.com/webhook', false);
    expect(valid).toBe(true);
  });

  it('should reject loopback and localhost when private URLs are forbidden', async () => {
    expect(await validateEndpointUrl('http://localhost:4000/hook', false)).toBe(false);
    expect(await validateEndpointUrl('http://127.0.0.1:4000/hook', false)).toBe(false);
    expect(await validateEndpointUrl('http://[::1]:4000/hook', false)).toBe(false);
  });

  it('should allow loopback/private URLs when allowPrivate is true (development mode)', async () => {
    expect(await validateEndpointUrl('http://localhost:4000/hook', true)).toBe(true);
    expect(await validateEndpointUrl('http://127.0.0.1:4000/hook', true)).toBe(true);
    expect(await validateEndpointUrl('http://receiver:4000/hook', true)).toBe(true);
  });

  it('should reject non-HTTP/HTTPS protocols', async () => {
    expect(await validateEndpointUrl('ftp://example.com/file', true)).toBe(false);
    expect(await validateEndpointUrl('file:///etc/passwd', true)).toBe(false);
    expect(await validateEndpointUrl('javascript:alert(1)', true)).toBe(false);
  });
});
