import { describe, it, expect } from 'vitest';
import { looksLikeCalendarImport, hasTag } from '../src/core.js';

describe('Calendar Import Detection', () => {
  const mockConfig = {
    calendarDetectionWindowMinutes: 5,
  };

  describe('looksLikeCalendarImport', () => {
    it('should detect recurring tasks with scheduled time as calendar imports', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task1',
        title: 'Weekly Meeting',
        created: new Date('2024-01-15T09:59:00Z').getTime(), // Created 1 minute ago
        dueWithTime: new Date('2024-01-15T14:00:00Z').getTime(),
        timeEstimate: 0,
        repeatCfg: { repeatEvery: 1, repeatEveryUnit: 'week' },
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(true);
    });

    it('should detect recently created tasks with scheduled time but no estimate', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task2',
        title: 'Doctor Appointment',
        created: new Date('2024-01-15T09:58:00Z').getTime(), // Created 2 minutes ago
        dueWithTime: new Date('2024-01-16T15:00:00Z').getTime(),
        timeEstimate: 0,
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(true);
    });

    it('should not detect old tasks even if they have scheduled time', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task3',
        title: 'Old Task',
        created: new Date('2024-01-10T09:00:00Z').getTime(), // Created 5 days ago
        dueWithTime: new Date('2024-01-16T15:00:00Z').getTime(),
        timeEstimate: 0,
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(false);
    });

    it('should not detect recently created tasks with time estimates', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task4',
        title: 'Work Task',
        created: new Date('2024-01-15T09:59:00Z').getTime(),
        dueWithTime: new Date('2024-01-16T15:00:00Z').getTime(),
        timeEstimate: 3600000, // 1 hour estimate
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(false);
    });

    it('should not detect tasks without scheduled time', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task5',
        title: 'Unscheduled Task',
        created: new Date('2024-01-15T09:59:00Z').getTime(),
        timeEstimate: 0,
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(false);
    });

    it('should handle tasks without creation timestamp', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task6',
        title: 'Task Without Created',
        dueWithTime: new Date('2024-01-16T15:00:00Z').getTime(),
        timeEstimate: 0,
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(false);
    });

    it('should use custom detection window from config', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const customConfig = {
        calendarDetectionWindowMinutes: 10, // 10 minutes instead of 5
      };
      const task = {
        id: 'task7',
        title: 'Task Created 8 Minutes Ago',
        created: new Date('2024-01-15T09:52:00Z').getTime(), // 8 minutes ago
        dueWithTime: new Date('2024-01-16T15:00:00Z').getTime(),
        timeEstimate: 0,
      };

      // Would be false with 5-minute window
      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(false);
      
      // Should be true with 10-minute window
      expect(looksLikeCalendarImport(task, customConfig, now)).toBe(true);
    });

    it('should handle edge case: task created exactly at detection window boundary', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task8',
        title: 'Task at Boundary',
        created: new Date('2024-01-15T09:55:00Z').getTime(), // Exactly 5 minutes ago
        dueWithTime: new Date('2024-01-16T15:00:00Z').getTime(),
        timeEstimate: 0,
      };

      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(true);
    });

    it('should detect recurring tasks even with minimal estimate', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const task = {
        id: 'task9',
        title: 'Recurring Calendar Event',
        created: new Date('2024-01-15T09:59:00Z').getTime(),
        dueWithTime: new Date('2024-01-15T14:00:00Z').getTime(),
        timeEstimate: 900000, // 15 minutes - some imports might have estimates
        repeatCfg: { repeatEvery: 1, repeatEveryUnit: 'day' },
      };

      // Recurring + scheduled should match even with an estimate
      expect(looksLikeCalendarImport(task, mockConfig, now)).toBe(true);
    });
  });
});
