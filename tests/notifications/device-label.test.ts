import { describe, expect, it } from 'vitest';
import { deviceLabel } from '@/services/notifications';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

describe('deviceLabel', () => {
  it.each([
    [UA.chromeWindows, 'Chrome on Windows'],
    [UA.edgeWindows, 'Edge on Windows'],
    [UA.safariIphone, 'Safari on iPhone'],
    [UA.chromeIphone, 'Chrome on iPhone'],
    [UA.safariMac, 'Safari on macOS'],
    [UA.firefoxLinux, 'Firefox on Linux'],
    [UA.chromeAndroid, 'Chrome on Android'],
    [UA.samsungAndroid, 'Samsung Internet on Android'],
    [UA.safariIpad, 'Safari on iPad'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });

  it('falls back to "a new browser" for missing or unrecognised agents', () => {
    expect(deviceLabel(null)).toBe('a new browser');
    expect(deviceLabel('')).toBe('a new browser');
    expect(deviceLabel('vitest')).toBe('a new browser');
    expect(deviceLabel('<script>alert(1)</script>')).toBe('a new browser');
  });

  it('never echoes attacker-controlled text', () => {
    const hostile = 'Mozilla/5.0 (Windows NT 10.0) Chrome/1.0 CLICK http://evil.example/login';
    const label = deviceLabel(hostile);
    expect(label).toBe('Chrome on Windows');
    expect(label).not.toContain('evil');
  });
});
