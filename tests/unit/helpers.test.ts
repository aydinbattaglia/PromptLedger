import { describe, it, expect } from 'vitest';
import { parseCredits, extractBalance } from '../../src/adapters/runway.js';
import { parseChars } from '../../src/adapters/elevenlabs.js';
import { parseGpuHours } from '../../src/adapters/midjourney.js';

describe('parseCredits', () => {
  it('parses plain numbers', () => expect(parseCredits('2500')).toBe(2500));
  it('parses comma-formatted numbers', () => expect(parseCredits('2,500')).toBe(2500));
  it('extracts number from "2,150 credits"', () => expect(parseCredits('2,150 credits')).toBe(2150));
  it('extracts first number from "500 / 10,000"', () => expect(parseCredits('500 / 10,000')).toBe(500));
  it('returns 0 for empty string', () => expect(parseCredits('')).toBe(0));
  it('returns 0 for non-numeric string', () => expect(parseCredits('N/A')).toBe(0));
});

describe('extractBalance', () => {
  it('returns null for non-objects', () => {
    expect(extractBalance(null)).toBeNull();
    expect(extractBalance('string')).toBeNull();
    expect(extractBalance(42)).toBeNull();
  });

  it('reads top-level credits key', () => expect(extractBalance({ credits: 100 })).toBe(100));
  it('reads remainingCredits key', () => expect(extractBalance({ remainingCredits: 200 })).toBe(200));
  it('reads credit_balance key', () => expect(extractBalance({ credit_balance: 300 })).toBe(300));
  it('reads balance key', () => expect(extractBalance({ balance: 400 })).toBe(400));
  it('reads creditsRemaining key', () => expect(extractBalance({ creditsRemaining: 500 })).toBe(500));

  it('reads nested user.credits', () =>
    expect(extractBalance({ user: { credits: 150 } })).toBe(150));

  it('reads nested data.credits', () =>
    expect(extractBalance({ data: { remainingCredits: 250 } })).toBe(250));

  it('returns null for empty object', () => expect(extractBalance({})).toBeNull());
  it('returns null when credit fields are strings', () =>
    expect(extractBalance({ credits: '100' })).toBeNull());
  it('returns 0 when credits is 0', () => expect(extractBalance({ credits: 0 })).toBe(0));
});

describe('parseChars', () => {
  it('parses plain numbers', () => expect(parseChars('10000')).toBe(10000));
  it('parses comma-formatted numbers', () => expect(parseChars('9,500')).toBe(9500));
  it('extracts from "9,500 / 10,000"', () => expect(parseChars('9,500 / 10,000')).toBe(9500));
  it('extracts from "1234 characters remaining"', () => expect(parseChars('1234 characters remaining')).toBe(1234));
  it('returns 0 for empty string', () => expect(parseChars('')).toBe(0));
});

describe('parseGpuHours', () => {
  it('parses decimal hours "14.7 hr"', () => expect(parseGpuHours('14.7 hr')).toBeCloseTo(14.7));
  it('parses whole hours "10 hr"', () => expect(parseGpuHours('10 hr')).toBe(10));
  it('parses "hr min" format "14 hr 42 min"', () => expect(parseGpuHours('14 hr 42 min')).toBeCloseTo(14.7));
  it('parses minutes-only "876 min"', () => expect(parseGpuHours('876 min')).toBeCloseTo(14.6));
  it('parses "30 min"', () => expect(parseGpuHours('30 min')).toBeCloseTo(0.5));
  it('parses plain number as hours', () => expect(parseGpuHours('14.7')).toBeCloseTo(14.7));
  it('returns 0 for empty string', () => expect(parseGpuHours('')).toBe(0));
  it('returns 0 for non-numeric string', () => expect(parseGpuHours('N/A')).toBe(0));
});
