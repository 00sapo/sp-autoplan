/**
 * Tests for AutoPlan utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  toRoman,
  hoursBetween,
  daysBetween,
  getTaskAgeInDays,
  getEstimatedHours,
  getRemainingHours,
  getTaskDueDate,
  escapeRegex,
} from '../src/core.js';

describe('toRoman', () => {
  it('converts basic numbers correctly', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(2)).toBe('II');
    expect(toRoman(3)).toBe('III');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(5)).toBe('V');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(10)).toBe('X');
  });

  it('converts larger numbers correctly', () => {
    expect(toRoman(50)).toBe('L');
    expect(toRoman(100)).toBe('C');
    expect(toRoman(500)).toBe('D');
    expect(toRoman(1000)).toBe('M');
    expect(toRoman(1994)).toBe('MCMXCIV');
    expect(toRoman(2024)).toBe('MMXXIV');
  });

  it('handles edge case of 0', () => {
    expect(toRoman(0)).toBe('I'); // Should return 'I' as minimum
  });

  it('handles negative numbers', () => {
    expect(toRoman(-5)).toBe('I'); // Should return 'I' as minimum
  });

  it('handles numbers above 3999', () => {
    expect(toRoman(4000)).toBe('4000'); // Returns string representation
    expect(toRoman(5000)).toBe('5000');
  });
});

describe('hoursBetween', () => {
  it('calculates hours between two dates', () => {
    const date1 = new Date('2024-01-01T00:00:00');
    const date2 = new Date('2024-01-01T02:00:00');
    expect(hoursBetween(date1, date2)).toBe(2);
  });

  it('handles reverse order (absolute value)', () => {
    const date1 = new Date('2024-01-01T02:00:00');
    const date2 = new Date('2024-01-01T00:00:00');
    expect(hoursBetween(date1, date2)).toBe(2);
  });

  it('handles fractional hours', () => {
    const date1 = new Date('2024-01-01T00:00:00');
    const date2 = new Date('2024-01-01T01:30:00');
    expect(hoursBetween(date1, date2)).toBe(1.5);
  });

  it('handles same date', () => {
    const date = new Date('2024-01-01T00:00:00');
    expect(hoursBetween(date, date)).toBe(0);
  });
});

describe('daysBetween', () => {
  it('calculates days between two dates', () => {
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-01-08');
    expect(daysBetween(date1, date2)).toBe(7);
  });

  it('handles fractional days', () => {
    const date1 = new Date('2024-01-01T00:00:00');
    const date2 = new Date('2024-01-01T12:00:00');
    expect(daysBetween(date1, date2)).toBe(0.5);
  });

  it('handles reverse order', () => {
    const date1 = new Date('2024-01-08');
    const date2 = new Date('2024-01-01');
    expect(daysBetween(date1, date2)).toBe(7);
  });
});

describe('getTaskAgeInDays', () => {
  it('calculates task age correctly', () => {
    const now = new Date('2024-01-15');
    const task = { created: new Date('2024-01-10').getTime() };
    expect(getTaskAgeInDays(task, now)).toBe(5);
  });

  it('returns 0 for task without created field', () => {
    const task = {};
    expect(getTaskAgeInDays(task)).toBe(0);
  });

  it('handles string created date', () => {
    const now = new Date('2024-01-15T00:00:00');
    const task = { created: '2024-01-10T00:00:00' };
    expect(getTaskAgeInDays(task, now)).toBe(5);
  });
});

describe('getEstimatedHours', () => {
  it('converts milliseconds to hours', () => {
    const task = { timeEstimate: 2 * 60 * 60 * 1000 }; // 2 hours in ms
    expect(getEstimatedHours(task)).toBe(2);
  });

  it('returns 0 for no estimate', () => {
    expect(getEstimatedHours({})).toBe(0);
    expect(getEstimatedHours({ timeEstimate: 0 })).toBe(0);
    expect(getEstimatedHours({ timeEstimate: null })).toBe(0);
  });

  it('handles fractional hours', () => {
    const task = { timeEstimate: 1.5 * 60 * 60 * 1000 }; // 1.5 hours
    expect(getEstimatedHours(task)).toBe(1.5);
  });
});

describe('getRemainingHours', () => {
  it('calculates remaining time correctly', () => {
    const task = {
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
      timeSpent: 1 * 60 * 60 * 1000, // 1 hour spent
    };
    expect(getRemainingHours(task)).toBe(3);
  });

  it('returns 0 when overdue (spent > estimate)', () => {
    const task = {
      timeEstimate: 1 * 60 * 60 * 1000,
      timeSpent: 2 * 60 * 60 * 1000,
    };
    expect(getRemainingHours(task)).toBe(0);
  });

  it('handles no time spent', () => {
    const task = { timeEstimate: 2 * 60 * 60 * 1000 };
    expect(getRemainingHours(task)).toBe(2);
  });

  it('handles no estimate', () => {
    const task = { timeSpent: 1 * 60 * 60 * 1000 };
    expect(getRemainingHours(task)).toBe(0);
  });
});

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('test*')).toBe('test\\*');
    expect(escapeRegex('a+b')).toBe('a\\+b');
    expect(escapeRegex('what?')).toBe('what\\?');
  });

  it('handles multiple special characters', () => {
    expect(escapeRegex('(test)[1]')).toBe('\\(test\\)\\[1\\]');
  });

  it('handles strings without special characters', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });
});

describe('getTaskDueDate', () => {
  it('returns Date from dueWithTime field', () => {
    const timestamp = new Date('2024-01-20T15:00:00').getTime();
    const task = { dueWithTime: timestamp };
    const result = getTaskDueDate(task);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(timestamp);
  });

  it('returns Date from dueDate field when dueWithTime is not set', () => {
    const timestamp = new Date('2024-01-20').getTime();
    const task = { dueDate: timestamp };
    const result = getTaskDueDate(task);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(timestamp);
  });

  it('prefers dueWithTime over dueDate', () => {
    const dueWithTime = new Date('2024-01-20T15:00:00').getTime();
    const dueDate = new Date('2024-01-21').getTime();
    const task = { dueWithTime, dueDate };
    const result = getTaskDueDate(task);
    expect(result.getTime()).toBe(dueWithTime);
  });

  it('returns null when no due date is set', () => {
    const task = { title: 'Test Task' };
    expect(getTaskDueDate(task)).toBe(null);
  });

  it('returns null for task with undefined dueDate', () => {
    const task = { dueDate: undefined };
    expect(getTaskDueDate(task)).toBe(null);
  });
});
