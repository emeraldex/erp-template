import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkFileType, cleanFilename, decodeUploadName } from '../../src/attachments/file-types';
import { LocalStorage, S3Storage, storageFromEnv } from '../../src/attachments/storage';

const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const KEY = 'job/ab/123e4567-e89b-42d3-a456-426614174000';

describe('upload type checks', () => {
  it('accepts a file whose name, type and contents agree', () => {
    expect(checkFileType('F174 release.pdf', 'application/pdf', PDF)).toBeNull();
    expect(checkFileType('photo.PNG', 'image/png', PNG)).toBeNull();
    expect(checkFileType('notes.txt', 'text/plain', Buffer.from('ok'))).toBeNull();
  });

  it('rejects disallowed types, mismatched extensions and disguised contents', () => {
    expect(checkFileType('run.exe', 'application/x-msdownload', Buffer.from('MZ'))).toMatch(/not allowed/);
    expect(checkFileType('page.html', 'text/html', Buffer.from('<script>'))).toMatch(/not allowed/);
    expect(checkFileType('report.png', 'application/pdf', PDF)).toMatch(/extension/);
    expect(checkFileType('fake.pdf', 'application/pdf', PNG)).toMatch(/not a valid PDF/);
    expect(checkFileType('bin.txt', 'text/plain', Buffer.from([0x41, 0x00]))).toMatch(/binary/);
  });

  it('recovers UTF-8 file names that the multipart parser read as Latin-1', () => {
    expect(decodeUploadName(Buffer.from('signed é.pdf', 'utf8').toString('latin1'))).toBe('signed é.pdf');
    expect(decodeUploadName('plain.pdf')).toBe('plain.pdf');
    expect(decodeUploadName('caf\u00e9.pdf')).toBe('caf\u00e9.pdf'); // genuine Latin-1, not valid UTF-8: unchanged
  });

  it('cleans file names of paths, control characters and quotes', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('C:\\Users\\a\\F134 "final".pdf')).toBe('F134 _final_.pdf');
    expect(cleanFilename('..hidden')).toBe('hidden');
    expect(cleanFilename('')).toBe('file');
    expect(cleanFilename('a'.repeat(300) + '.pdf')).toHaveLength(120);
  });
});

describe('LocalStorage', () => {
  it('round-trips bytes and refuses keys it did not generate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'erp-store-'));
    const s = new LocalStorage(dir);
    await s.put(KEY, PDF);
    expect(await s.get(KEY)).toEqual(PDF);
    expect(readdirSync(join(dir, 'job', 'ab'))).toEqual(['123e4567-e89b-42d3-a456-426614174000']);
    await expect(s.put('../escape', PDF)).rejects.toThrow(/unexpected storage key/);
    await expect(s.get('job/ab/../../x')).rejects.toThrow(/unexpected storage key/);
    await expect(s.put(KEY, PDF)).rejects.toThrow(); // never overwrites
  });
});

describe('S3Storage', () => {
  it('puts with the content type and server-side encryption, and reads the body back', async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (cmd: unknown) => {
        sent.push(cmd);
        return cmd instanceof GetObjectCommand ? { Body: { transformToByteArray: async () => new Uint8Array(PDF) } } : {};
      },
    };
    const s = new S3Storage(client as never, 'erp-bucket', 'tenant-a/');
    await s.put(KEY, PDF, 'application/pdf');
    expect(await s.get(KEY)).toEqual(PDF);
    const put = sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toEqual(expect.objectContaining({
      Bucket: 'erp-bucket', Key: `tenant-a/${KEY}`, ContentType: 'application/pdf', ServerSideEncryption: 'AES256',
    }));
  });

  it('is chosen by STORAGE_DRIVER and requires a bucket', () => {
    expect(() => storageFromEnv({ STORAGE_DRIVER: 's3' })).toThrow('S3_BUCKET');
    expect(storageFromEnv({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }).name).toBe('s3');
    expect(storageFromEnv({ ATTACHMENTS_DIR: tmpdir() }).name).toBe('local');
    expect(() => storageFromEnv({ STORAGE_DRIVER: 'ftp' })).toThrow('Unknown STORAGE_DRIVER');
  });
});
