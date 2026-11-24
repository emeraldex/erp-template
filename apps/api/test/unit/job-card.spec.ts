import QRCode = require('qrcode');
import { JobCardService } from '../../src/documents/job-card.service';
import { FakeStore, makeJob } from './fake-store';

describe('JobCardService', () => {
  const settings = { company: { name: 'Apex Aero' } };

  it('encodes a link to each job’s page in its QR code, one A6 page per job', async () => {
    const store = new FakeStore();
    store.newJob(makeJob({ id: 'PS-2026-0001' }));
    store.newJob(makeJob({ id: 'PS-2026-0002', priority: { type: 'AOG', route: 'OV', state: 'OPEN', quantity: 1, suffixK: false, colRef: 'C', raisedAt: '', raisedBy: '', audit: [] } as never }));
    const spy = jest.spyOn(QRCode, 'toBuffer');
    const svc = new JobCardService(store.asStore(), settings as never);
    const { filename, pdf } = await svc.cards(['PS-2026-0001', 'PS-2026-0002', 'PS-2026-0001'], 'https://erp.example.com/');
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['https://erp.example.com/jobs/PS-2026-0001', 'https://erp.example.com/jobs/PS-2026-0002']);
    expect(filename).toBe('job-cards-2.pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
    spy.mockRestore();
  });

  it('validates the request', async () => {
    const svc = new JobCardService(new FakeStore().asStore(), settings as never);
    await expect(svc.cards([], 'https://x')).rejects.toThrow('at least one job');
    await expect(svc.cards(['PS-404'], 'https://x')).rejects.toThrow('Job PS-404 not found');
    await expect(svc.cards(Array.from({ length: 101 }, (_, i) => `PS-${i}`), 'https://x')).rejects.toThrow('At most 100');
  });
});
