import { describe, expect, it } from 'vitest';
import { homeFor, landingFor } from '@/lib/landing';

describe('landingFor', () => {
  it('sends each role to its own home without a next path', () => {
    expect(homeFor('SELLER')).toBe('/home');
    expect(homeFor('MANAGER')).toBe('/dashboard');
    expect(homeFor('ADMIN')).toBe('/dashboard');
    expect(landingFor('SELLER', null)).toBe('/home');
    expect(landingFor('SELLER', '/')).toBe('/home');
  });

  it('never sends a seller to a manager-only page', () => {
    expect(landingFor('SELLER', '/dashboard')).toBe('/home');
    expect(landingFor('SELLER', '/analytics/brands')).toBe('/home');
    expect(landingFor('SELLER', '/users')).toBe('/home');
  });

  it('keeps a next path the role may open', () => {
    expect(landingFor('SELLER', '/my-sales?open=abc')).toBe('/my-sales?open=abc');
    expect(landingFor('SELLER', '/products')).toBe('/products');
    expect(landingFor('MANAGER', '/stock/low')).toBe('/stock/low');
    expect(landingFor('MANAGER', '/profile')).toBe('/profile');
  });

  it('rejects external or auth-loop targets', () => {
    expect(landingFor('MANAGER', '//evil.example/x')).toBe('/dashboard');
    expect(landingFor('MANAGER', 'https://evil.example')).toBe('/dashboard');
    expect(landingFor('MANAGER', '/\\evil.example')).toBe('/dashboard');
    expect(landingFor('SELLER', '/login')).toBe('/home');
    expect(landingFor('SELLER', '/session-expired')).toBe('/home');
  });
});
