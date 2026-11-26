import { ConflictException, ForbiddenException } from '@nestjs/common';
import { JobsService } from '../../src/jobs/jobs.service';
import { FakeStore, fakeSettings, makeJob } from './fake-store';
import { GENERAL } from '../../src/packs/sectors';

describe('JobsService — assignment to named people', () => {
  let store: FakeStore;
  let svc: JobsService;
  const mm = { name: 'Hafiz', role: 'MM', sub: 'u-mm' };

  beforeEach(() => {
    store = new FakeStore();
    svc = new JobsService(store.asStore(), fakeSettings());
  });

  it('assigns, notifies the person and records it', async () => {
    store.newJob(makeJob());
    const job = await svc.assign('PS-2026-9001', 'u-tech', mm);
    expect(job).toEqual(expect.objectContaining({ assigneeId: 'u-tech', assigneeName: 'Ravi Kumar' }));
    expect(job.audit.at(-1)?.action).toBe('Assigned to Ravi Kumar');
    expect(store.notifications).toEqual([expect.objectContaining({ userId: 'u-tech', kind: 'job.assigned', ref: 'JOB:PS-2026-9001' })]);
  });

  it('does not notify people who take work themselves, or re-save an unchanged assignment', async () => {
    store.newJob(makeJob());
    await svc.assign('PS-2026-9001', 'u-mm', mm);
    expect(store.notifications).toEqual([]);
    const saves = store.saves;
    await svc.assign('PS-2026-9001', 'u-mm', mm);
    expect(store.saves).toBe(saves);
  });

  it('refuses people who are not active staff, and closed jobs', async () => {
    store.newJob(makeJob());
    await expect(svc.assign('PS-2026-9001', 'u-gone', mm)).rejects.toThrow('Choose an active member of staff');
    store.newJob(makeJob({ id: 'PS-2026-9002', status: 'CLOSED' }));
    await expect(svc.assign('PS-2026-9002', 'u-tech', mm)).rejects.toThrow('editing locked');
  });

  it('lets a role that owns the next step claim free work, once', async () => {
    store.newJob(makeJob({ status: 'AWAITING_TDI' })); // AWAITING_TDI → TDI is a WORKSHOP step
    await expect(svc.claim('PS-2026-9001', { name: 'Rahim Osman', role: 'STORES', sub: 'u-stores' })).rejects.toThrow(ForbiddenException);
    const job = await svc.claim('PS-2026-9001', { name: 'Ravi Kumar', role: 'WORKSHOP', sub: 'u-tech' });
    expect(job.assigneeId).toBe('u-tech');
    await expect(svc.claim('PS-2026-9001', { name: 'Hafiz', role: 'MM', sub: 'u-mm' })).rejects.toThrow(ConflictException);
  });

  it('assigns through a step that has the assignTo action', async () => {
    const general = new FakeStore(GENERAL);
    general.people.push({ id: 'u-hd', name: 'Nur Aina', role: 'HELPDESK', branch: 'HQ' });
    const s = new JobsService(general.asStore(), fakeSettings(GENERAL));
    general.newJob(makeJob({ status: 'OPEN', location: 'ON_SITE' }));
    const job = await s.transition('PS-2026-9001', 'ASSIGNED', { assignee: 'u-tech' }, { name: 'Nur Aina', role: 'HELPDESK', sub: 'u-hd' });
    expect(job).toEqual(expect.objectContaining({ status: 'ASSIGNED', assigneeId: 'u-tech' }));
    expect(general.notifications).toHaveLength(1);
    general.newJob(makeJob({ id: 'PS-2026-9002', status: 'OPEN', location: 'ON_SITE' }));
    await expect(s.transition('PS-2026-9002', 'ASSIGNED', { assignee: 'nobody' }, { name: 'Nur Aina', role: 'HELPDESK' })).rejects.toThrow('active member of staff');
  });
});
