import { describe, it, expect } from 'vitest';
import { intParam } from './api';

describe('intParam', () => {
  it('uses the fallback when the parameter is absent', () => {
    // Number(null) is 0, which would otherwise become a limit of zero and
    // silently return no rows.
    expect(intParam(null, 50)).toBe(50);
  });

  it('uses the fallback for a blank value', () => {
    expect(intParam('', 50)).toBe(50);
    expect(intParam('   ', 50)).toBe(50);
  });

  it('uses the fallback for a non-numeric value', () => {
    expect(intParam('abc', 50)).toBe(50);
    expect(intParam('NaN', 50)).toBe(50);
  });

  it('reads a valid number', () => {
    expect(intParam('10', 50)).toBe(10);
    expect(intParam('0', 50)).toBe(0);
  });

  it('truncates a fractional value', () => {
    expect(intParam('10.9', 50)).toBe(10);
  });

  it('rejects a negative value', () => {
    expect(intParam('-5', 50)).toBe(50);
  });

  it('clamps to the maximum', () => {
    expect(intParam('9999', 25, 200)).toBe(200);
    expect(intParam('50', 25, 200)).toBe(50);
  });
});
