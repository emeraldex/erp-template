process.env.AUTH_SECRET ??= 'unit-secret-0123456789abcdef0123456789abcdef';
import { seal, unseal } from '../../src/auth/sso-config.service';

describe('SSO client secret sealing', () => {
  it('round-trips, uses a fresh IV each time, and detects tampering', () => {
    const a = seal('s3cret');
    const b = seal('s3cret');
    expect(a).not.toBe(b);
    expect(unseal(a)).toBe('s3cret');
    const [v, iv, tag, ct] = a.split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => unseal([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => unseal('v2.x.y.z')).toThrow('Unknown secret format');
  });
});
