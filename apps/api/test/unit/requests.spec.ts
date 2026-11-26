import { checkToken, cleanInput, makeToken, newSalt, requestEmail, stageOf, tokenId } from '../../src/requests/logic';

const SECRET = 'unit-secret-0123456789abcdef0123456789abcdef';

describe('tracking links', () => {
  const salt = newSalt();
  const token = makeToken(SECRET, 'acme', 'REQ-2026-0001', salt);

  it('verifies its own token and names the request', () => {
    expect(tokenId(token)).toBe('REQ-2026-0001');
    expect(checkToken(SECRET, 'acme', token, salt)).toBe(true);
  });

  it('refuses a tampered, foreign or cancelled token', () => {
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(checkToken(SECRET, 'acme', tampered, salt)).toBe(false);
    expect(checkToken(SECRET, 'beta', token, salt)).toBe(false); // another organisation
    expect(checkToken(SECRET, 'acme', token, newSalt())).toBe(false); // salt changed
    expect(checkToken('another-secret-0123456789abcdef0123456789', 'acme', token, salt)).toBe(false);
    const other = makeToken(SECRET, 'acme', 'REQ-2026-0002', salt);
    expect(checkToken(SECRET, 'acme', `REQ-2026-0001.${other.split('.')[1]}`, salt)).toBe(false);
  });

  it('rejects anything that is not shaped like a token', () => {
    for (const bad of [undefined, 42, '', 'REQ-2026-0001', 'REQ-2026-0001.short', `../${token}`, `${token}x`, 'x'.repeat(200)]) {
      expect(tokenId(bad)).toBeNull();
    }
  });
});

describe('stageOf', () => {
  it('tells the requester where things stand from the work order phase', () => {
    expect(stageOf('NEW', null)).toBe('received');
    expect(stageOf('DECLINED', null)).toBe('declined');
    expect(stageOf('CANCELLED', null)).toBe('cancelled');
    expect(stageOf('ACCEPTED', 'new')).toBe('accepted');
    expect(stageOf('ACCEPTED', 'active')).toBe('in_progress');
    expect(stageOf('ACCEPTED', 'waiting_parts')).toBe('waiting');
    expect(stageOf('ACCEPTED', 'external')).toBe('waiting');
    expect(stageOf('ACCEPTED', 'done')).toBe('done');
    expect(stageOf('ACCEPTED', 'closed')).toBe('done');
  });
});

describe('cleanInput', () => {
  it('accepts a good request and tidies it', () => {
    const { input, errors } = cleanInput({ description: '  Leaking tap in the pantry  ', name: ' Siti ', email: 'Siti@Example.com', place: 'Level 3   pantry', urgent: 'on', lang: 'ms' });
    expect(errors).toEqual([]);
    expect(input).toEqual(expect.objectContaining({ description: 'Leaking tap in the pantry', name: 'Siti', email: 'siti@example.com', place: 'Level 3 pantry', urgent: true, lang: 'ms' }));
  });

  it('lists every problem', () => {
    expect(cleanInput({ description: 'bad', name: 'x' }).errors).toEqual([
      'Say what is wrong (at least 5 characters)', 'Give your name', 'Give an email address or a phone number so the team can reach you',
    ]);
    expect(cleanInput({ description: 'Broken light', name: 'Ali', email: 'not-an-email' }).errors).toEqual(['That email address does not look right']);
    expect(cleanInput({ description: 'Broken light', name: 'Ali', phone: 'call me' }).errors).toEqual(['That phone number does not look right']);
  });

  it('caps lengths and ignores non-text values', () => {
    const { input } = cleanInput({ description: 'x'.repeat(5000), name: { evil: 1 }, phone: '012-345 6789', lang: 'fr' });
    expect(input.description).toHaveLength(1000);
    expect(input.name).toBe('');
    expect(input.lang).toBe('en');
  });
});

describe('requestEmail', () => {
  it('writes in the requester\'s language and links to the tracking page', () => {
    const en = requestEmail('received', 'en', { org: 'North FM', id: 'REQ-2026-0001', link: 'https://x/r/track#t' });
    expect(en.subject).toBe('REQ-2026-0001: we have your request');
    expect(en.text).toContain('https://x/r/track#t');
    expect(requestEmail('done', 'ms', { org: 'North FM', id: 'REQ-2026-0001', link: 'L' }).subject).toBe('REQ-2026-0001: kerja selesai');
    expect(requestEmail('declined', 'en', { org: 'O', id: 'R', link: 'L', reason: 'Not our building' }).text).toContain('Reason: Not our building');
  });
});
