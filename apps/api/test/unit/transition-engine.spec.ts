import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { applyTransition } from '../../src/common/transition.engine';
import { JOB_TRANSITIONS } from '../../src/common/workflow-config';
import { actor, makeJob } from './fake-store';

describe('applyTransition (FR-02 … FR-05)', () => {
  const rules = JOB_TRANSITIONS;

  it('moves the status, sets location, files the form record and appends an audit entry', () => {
    const job = makeJob();
    applyTransition(job, rules, 'AWAITING_TDI', { f219Ref: 'F219-1' }, actor('STORES', 'Rahim'));
    expect(job.status).toBe('AWAITING_TDI');
    expect(job.location).toBe('BAY');
    expect(job.records).toEqual([expect.objectContaining({ formNo: 'F219', refNo: 'F219-1', by: 'Rahim' })]);
    expect(job.audit.at(-1)).toEqual(expect.objectContaining({
      by: 'Rahim', role: 'STORES', action: 'Status → AWAITING_TDI: Dispatch to workshop', fields: { f219Ref: 'F219-1' },
    }));
  });

  it('rejects a transition the workflow does not define (FR-02)', () => {
    const job = makeJob();
    expect(() => applyTransition(job, rules, 'SERVICEABLE', {}, actor('ADMIN'))).toThrow(BadRequestException);
    expect(job.status).toBe('REGISTERED');
  });

  it('rejects a role that does not own the stage, naming the owners (FR-03)', () => {
    const job = makeJob();
    expect(() => applyTransition(job, rules, 'AWAITING_TDI', { f219Ref: 'F219-1' }, actor('WORKSHOP')))
      .toThrow(new ForbiddenException('Stage owned by: STORES (process owner) — your role WORKSHOP may not set this status'));
    expect(job.status).toBe('REGISTERED');
    expect(job.audit).toHaveLength(0);
  });

  it('lets ADMIN act on any stage', () => {
    const job = makeJob();
    applyTransition(job, rules, 'AWAITING_TDI', { f219Ref: 'F219-1' }, actor('ADMIN'));
    expect(job.status).toBe('AWAITING_TDI');
  });

  it('enforces mandatory fields, treating whitespace as missing (FR-05)', () => {
    const job = makeJob({ status: 'AWAITING_TDI' });
    expect(() => applyTransition(job, rules, 'TDI', { f116Ref: 'F116-1', findings: '   ' }, actor('WORKSHOP')))
      .toThrow('Mandatory fields missing: Findings / fault values');
    expect(job.status).toBe('AWAITING_TDI');
    expect(job.records).toHaveLength(0);
  });

  it('only files fields that carry a form number into the records register', () => {
    const job = makeJob({ status: 'AWAITING_TDI' });
    applyTransition(job, rules, 'TDI', { f116Ref: 'F116-1', findings: 'PSU drift' }, actor('WORKSHOP'));
    expect(job.records.map((r) => r.formNo)).toEqual(['F116']);
  });
});
