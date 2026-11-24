import { createHash, randomBytes } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';

/** A minimal OpenID Connect provider for tests: discovery, JWKS, authorize, token. */
export class MockOidc {
  issuer = '';
  nextEmail = 'rahim@company.example';
  /** Test knobs for failure cases. */
  tamper: { nonce?: boolean; foreignKey?: boolean; emailVerified?: boolean } = {};
  private server!: Server;
  private key!: KeyLike;
  private foreign!: KeyLike;
  private jwk!: object;
  private codes = new Map<string, { nonce: string; challenge: string; redirect: string; email: string }>();

  async start(clientId: string, clientSecret: string): Promise<void> {
    const kp = await generateKeyPair('RS256');
    this.key = kp.privateKey;
    this.foreign = (await generateKeyPair('RS256')).privateKey;
    this.jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url!, this.issuer);
      const json = (status: number, body: object) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (url.pathname === '/.well-known/openid-configuration') {
        return json(200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
      }
      if (url.pathname === '/jwks') return json(200, { keys: [this.jwk] });
      if (url.pathname === '/authorize') {
        const p = url.searchParams;
        if (p.get('client_id') !== clientId || p.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
        const code = randomBytes(12).toString('hex');
        this.codes.set(code, { nonce: p.get('nonce')!, challenge: p.get('code_challenge')!, redirect: p.get('redirect_uri')!, email: this.nextEmail });
        res.writeHead(302, { Location: `${p.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(p.get('state')!)}` });
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const f = new URLSearchParams(raw);
        const entry = this.codes.get(f.get('code') ?? '');
        this.codes.delete(f.get('code') ?? '');
        if (!entry || f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret || f.get('redirect_uri') !== entry.redirect) {
          return json(400, { error: 'invalid_grant' });
        }
        if (createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== entry.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
        const idToken = await new SignJWT({
          email: entry.email, email_verified: this.tamper.emailVerified ?? true, nonce: this.tamper.nonce ? 'wrong' : entry.nonce,
        }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(this.issuer).setAudience(clientId).setSubject(`sub-${entry.email}`)
          .setIssuedAt().setExpirationTime('5m').sign(this.tamper.foreignKey ? this.foreign : this.key);
        return json(200, { access_token: 'at', token_type: 'Bearer', id_token: idToken });
      }
      json(404, { error: 'not_found' });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }
}
