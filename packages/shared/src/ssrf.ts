import { lookup } from 'node:dns/promises';

const PRIVATE_IP_RANGES = [
  /^127\./,                         // 127.0.0.0/8
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^169\.254\./,                    // 169.254.0.0/16 (link-local)
  /^0\./,                           // 0.0.0.0/8
  /^::1$/,                          // IPv6 loopback
  /^fc00:/i,                        // IPv6 unique local
  /^fe80:/i,                        // IPv6 link-local
];

export async function validateEndpointUrl(urlString: string, allowPrivate = false): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (allowPrivate) {
    return true;
  }

  const hostname = parsed.hostname;
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return false;
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      for (const pattern of PRIVATE_IP_RANGES) {
        if (pattern.test(addr.address)) {
          return false;
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}
