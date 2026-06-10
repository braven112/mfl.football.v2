import { describe, it, expect } from 'vitest';
import { isPrivateAddress, validatePublicUrl } from '../src/utils/url-guard';

describe('isPrivateAddress', () => {
  it('flags loopback, private, link-local, and CGNAT ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:10.0.0.1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '100.128.0.1', '2607:f8b0::1', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('validatePublicUrl', () => {
  it('rejects non-http schemes', async () => {
    expect(await validatePublicUrl('file:///etc/passwd')).toBeTruthy();
    expect(await validatePublicUrl('ftp://example.com/x')).toBeTruthy();
    expect(await validatePublicUrl('gopher://example.com')).toBeTruthy();
  });

  it('rejects non-standard ports and embedded credentials', async () => {
    expect(await validatePublicUrl('http://example.com:8080/')).toBeTruthy();
    expect(await validatePublicUrl('http://example.com:6379/')).toBeTruthy();
    expect(await validatePublicUrl('http://user:pass@example.com/')).toBeTruthy();
    expect(await validatePublicUrl('https://example.com:443/')).toBeNull();
  });

  it('rejects localhost-style and single-label hostnames', async () => {
    expect(await validatePublicUrl('http://localhost/')).toBeTruthy();
    expect(await validatePublicUrl('http://localhost:80/')).toBeTruthy();
    expect(await validatePublicUrl('http://intranet/')).toBeTruthy();
    expect(await validatePublicUrl('http://foo.local/')).toBeTruthy();
    expect(await validatePublicUrl('http://db.internal/')).toBeTruthy();
  });

  it('rejects private IP literals including the cloud metadata endpoint', async () => {
    expect(await validatePublicUrl('http://169.254.169.254/latest/meta-data/')).toBeTruthy();
    expect(await validatePublicUrl('http://127.0.0.1/')).toBeTruthy();
    expect(await validatePublicUrl('http://10.1.2.3/')).toBeTruthy();
    expect(await validatePublicUrl('http://192.168.0.10/')).toBeTruthy();
    expect(await validatePublicUrl('http://[::1]/')).toBeTruthy();
    expect(await validatePublicUrl('http://[fe80::1]/')).toBeTruthy();
  });

  it('allows public IP literals', async () => {
    expect(await validatePublicUrl('http://8.8.8.8/')).toBeNull();
  });

  it('rejects malformed URLs', async () => {
    expect(await validatePublicUrl('not a url')).toBeTruthy();
  });
});
