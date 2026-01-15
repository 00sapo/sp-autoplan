/**
 * Tests for AutoPlanner module
 */

import { describe, it, expect } from 'vitest';
import { AutoPlanner, TaskSplitter, DEFAULT_CONFIG } from '../src/core.js';

// Helper to create a task
function createTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    timeSpent: 0,
    tagIds: [],
    projectId: 'project-1',
    parentId: null,
    created: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
    isDone: false,
    notes: '',
    ...overrides,
  };
}

describe('AutoPlanner.getCurrentDayMinutes', () => {
  it('returns 0 before work start', () => {
    const now = new Date('2024-01-15T08:00:00');
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(0);
  });

  it('calculates minutes since work start', () => {
    const now = new Date('2024-01-15T11:30:00'); // 2.5 hours after 9 AM
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(150);
  });

  it('handles exactly at work start', () => {
    const now = new Date('2024-01-15T09:00:00');
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(0);
  });

  it('handles late in the day', () => {
    const now = new Date('2024-01-15T17:00:00'); // 8 hours after 9 AM
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(480);
  });

  it('respects custom work start hour', () => {
    const now = new Date('2024-01-15T10:30:00');
    expect(AutoPlanner.getCurrentDayMinutes(now, 8)).toBe(150); // 2.5h after 8 AM
    expect(AutoPlanner.getCurrentDayMinutes(now, 10)).toBe(30); // 0.5h after 10 AM
  });
});

describe('AutoPlanner.schedule', () => {
  const allTags = [];
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    workdayStartHour: 9,
    workdayHours: 8,
    maxDaysAhead: 30,
  };

  it('schedules splits in order of urgency', () => {
    const tasks = [
      createTask({ id: 'task-1', title: 'First', timeEstimate: 2 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', title: 'Second', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, config));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const schedule = AutoPlanner.schedule(splits, config, allTags, startTime);

    expect(schedule).toHaveLength(2);
    // First task has higher base priority (position 1 of 2)
    expect(schedule[0].split.originalTaskId).toBe('task-1');
    expect(schedule[1].split.originalTaskId).toBe('task-2');
  });

  it('respects work day limits', () => {
    const task = createTask({
      id: 'task-1',
      title: 'Long Task',
      timeEstimate: 12 * 60 * 60 * 1000, // 12 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    expect(splits).toHaveLength(6);

    const startTime = new Date('2024-01-15T09:00:00');
    const schedule = AutoPlanner.schedule(splits, config, allTags, startTime);

    expect(schedule).toHaveLength(6);

    // First 4 blocks should be on day 1 (8 hours)
    const day1 = schedule.filter(s => s.startTime.getDate() === 15);
    const day2 = schedule.filter(s => s.startTime.getDate() === 16);

    expect(day1).toHaveLength(4);
    expect(day2).toHaveLength(2);
  });

  it('starts from current time if during work hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T14:00:00'); // 2 PM = 5 hours into workday
    const schedule = AutoPlanner.schedule(splits, config, allTags, startTime);

    expect(schedule).toHaveLength(1);
    // Should start at 2 PM (14:00)
    expect(schedule[0].startTime.getHours()).toBe(14);
    expect(schedule[0].startTime.getMinutes()).toBe(0);
  });

  it('moves to next day if past work hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T18:00:00'); // 6 PM - after 8h workday
    const schedule = AutoPlanner.schedule(splits, config, allTags, startTime);

    expect(schedule).toHaveLength(1);
    expect(schedule[0].startTime.getDate()).toBe(16); // Next day
  });

  it('respects maxDaysAhead limit', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours = 12.5 work days
    });

    const limitedConfig = { ...config, maxDaysAhead: 5 };
    const splits = TaskSplitter.splitTask(task, 120, limitedConfig);

    const startTime = new Date('2024-01-15T09:00:00');
    const schedule = AutoPlanner.schedule(splits, limitedConfig, allTags, startTime);

    // Should stop before scheduling all blocks
    expect(schedule.length).toBeLessThan(splits.length);

    // Check that all scheduled blocks are within 5 days
    const lastDate = schedule[schedule.length - 1].startTime;
    const daysDiff = (lastDate - startTime) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeLessThan(5);
  });

  it('returns empty array for empty splits', () => {
    const schedule = AutoPlanner.schedule([], config, allTags);
    expect(schedule).toHaveLength(0);
  });

  it('includes urgency information in schedule', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const schedule = AutoPlanner.schedule(splits, config, allTags, startTime);

    expect(schedule[0].urgency).toBeDefined();
    expect(schedule[0].urgencyComponents).toBeDefined();
    expect(schedule[0].urgencyComponents.base).toBeDefined();
  });

  it('schedules by priority with tag boosts', () => {
    const tagConfig = {
      ...config,
      tagPriorities: { urgent: 100 },
    };
    const allTagsList = [{ id: 'tag-urgent', name: 'urgent' }];

    const tasks = [
      createTask({ id: 'task-1', title: 'Normal', timeEstimate: 2 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', title: 'Urgent', timeEstimate: 2 * 60 * 60 * 1000, tagIds: ['tag-urgent'] }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, tagConfig));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const schedule = AutoPlanner.schedule(splits, tagConfig, allTagsList, startTime);

    // Urgent task should be scheduled first despite being second in list
    expect(schedule[0].split.originalTaskId).toBe('task-2');
  });

  it('re-evaluates urgency after each assignment', () => {
    // This tests the core algorithm: after scheduling one block,
    // urgency is recalculated, potentially changing priority order
    const longTaskConfig = {
      ...config,
      durationFormula: 'inverse', // Shorter = higher priority
      durationWeight: 10,
    };

    const tasks = [
      createTask({ id: 'long', title: 'Long', timeEstimate: 8 * 60 * 60 * 1000 }), // 4 blocks
      createTask({ id: 'short', title: 'Short', timeEstimate: 2 * 60 * 60 * 1000 }), // 1 block
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, longTaskConfig));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const schedule = AutoPlanner.schedule(splits, longTaskConfig, [], startTime);

    // Short task should be scheduled first due to inverse duration formula
    expect(schedule[0].split.originalTaskId).toBe('short');
  });
});

describe('AutoPlanner.shouldSkipDay', () => {
  it('returns false when skipDays is empty', () => {
    const date = new Date('2024-01-13T10:00:00'); // Saturday
    expect(AutoPlanner.shouldSkipDay(date, [])).toBe(false);
  });

  it('returns false when skipDays is undefined', () => {
    const date = new Date('2024-01-13T10:00:00'); // Saturday
    expect(AutoPlanner.shouldSkipDay(date, undefined)).toBe(false);
  });

  it('returns true for Saturday when 6 is in skipDays', () => {
    const date = new Date('2024-01-13T10:00:00'); // Saturday = 6
    expect(AutoPlanner.shouldSkipDay(date, [0, 6])).toBe(true);
  });

  it('returns true for Sunday when 0 is in skipDays', () => {
    const date = new Date('2024-01-14T10:00:00'); // Sunday = 0
    expect(AutoPlanner.shouldSkipDay(date, [0, 6])).toBe(true);
  });

  it('returns false for Monday when only weekend is skipped', () => {
    const date = new Date('2024-01-15T10:00:00'); // Monday = 1
    expect(AutoPlanner.shouldSkipDay(date, [0, 6])).toBe(false);
  });
});

describe('AutoPlanner.advanceToNextWorkday', () => {
  it('advances to next day when no skip days', () => {
    const date = new Date('2024-01-15T10:00:00'); // Monday
    const next = AutoPlanner.advanceToNextWorkday(date, [], 9);
    expect(next.getDate()).toBe(16); // Tuesday
    expect(next.getHours()).toBe(9);
  });

  it('skips Saturday and Sunday when weekend is in skipDays', () => {
    const friday = new Date('2024-01-12T10:00:00'); // Friday
    const next = AutoPlanner.advanceToNextWorkday(friday, [0, 6], 9);
    expect(next.getDate()).toBe(15); // Monday (skips Sat 13, Sun 14)
    expect(next.getDay()).toBe(1); // Monday
  });

  it('skips multiple consecutive days', () => {
    const thursday = new Date('2024-01-11T10:00:00'); // Thursday
    // Skip Fri, Sat, Sun (5, 6, 0)
    const next = AutoPlanner.advanceToNextWorkday(thursday, [0, 5, 6], 9);
    expect(next.getDate()).toBe(15); // Monday
    expect(next.getDay()).toBe(1);
  });

  it('sets correct work start hour', () => {
    const date = new Date('2024-01-15T10:00:00');
    const next = AutoPlanner.advanceToNextWorkday(date, [], 8);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });
});

describe('AutoPlanner.schedule with skipDays', () => {
  const config = {
    ...DEFAULT_CONFIG,
    blockSizeMinutes: 120,
    workdayStartHour: 9,
    workdayHours: 8,
    skipDays: [0, 6], // Skip Saturday and Sunday
  };

  it('skips weekends when scheduling across multiple days', () => {
    // Create enough tasks to span multiple days
    const task = createTask({
      id: 'task-1',
      timeEstimate: 24 * 60 * 60 * 1000, // 24 hours = 3 full work days
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Friday Jan 12, 2024
    const startTime = new Date('2024-01-12T09:00:00');
    const schedule = AutoPlanner.schedule(splits, config, [], startTime);

    // Should have 12 blocks (24h / 2h)
    expect(schedule.length).toBe(12);

    // Check that no blocks are scheduled on Saturday (13) or Sunday (14)
    const scheduledDays = schedule.map(s => ({
      date: s.startTime.getDate(),
      day: s.startTime.getDay()
    }));

    // Should not have any Saturday (6) or Sunday (0)
    expect(scheduledDays.every(d => d.day !== 0 && d.day !== 6)).toBe(true);

    // First 4 blocks on Friday (12), next 4 on Monday (15), last 4 on Tuesday (16)
    const fridayBlocks = schedule.filter(s => s.startTime.getDate() === 12);
    const mondayBlocks = schedule.filter(s => s.startTime.getDate() === 15);
    const tuesdayBlocks = schedule.filter(s => s.startTime.getDate() === 16);

    expect(fridayBlocks.length).toBe(4);
    expect(mondayBlocks.length).toBe(4);
    expect(tuesdayBlocks.length).toBe(4);
  });

  it('starts on next workday when starting on a skip day', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Saturday Jan 13, 2024
    const startTime = new Date('2024-01-13T10:00:00');
    const schedule = AutoPlanner.schedule(splits, config, [], startTime);

    expect(schedule.length).toBe(1);
    // Should be scheduled on Monday Jan 15
    expect(schedule[0].startTime.getDate()).toBe(15);
    expect(schedule[0].startTime.getDay()).toBe(1); // Monday
  });

  it('handles starting on Sunday', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Sunday Jan 14, 2024
    const startTime = new Date('2024-01-14T10:00:00');
    const schedule = AutoPlanner.schedule(splits, config, [], startTime);

    expect(schedule.length).toBe(1);
    // Should be scheduled on Monday Jan 15
    expect(schedule[0].startTime.getDate()).toBe(15);
  });

  it('works with no skip days configured', () => {
    const noSkipConfig = { ...config, skipDays: [] };
    const task = createTask({
      id: 'task-1',
      timeEstimate: 16 * 60 * 60 * 1000, // 16 hours = 2 days
    });

    const splits = TaskSplitter.splitTask(task, 120, noSkipConfig);
    // Friday Jan 12
    const startTime = new Date('2024-01-12T09:00:00');
    const schedule = AutoPlanner.schedule(splits, noSkipConfig, [], startTime);

    // Should schedule on Friday (4 blocks) and Saturday (4 blocks)
    const fridayBlocks = schedule.filter(s => s.startTime.getDate() === 12);
    const saturdayBlocks = schedule.filter(s => s.startTime.getDate() === 13);

    expect(fridayBlocks.length).toBe(4);
    expect(saturdayBlocks.length).toBe(4);
  });
});
