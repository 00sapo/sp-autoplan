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
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(2);
    // First task has higher base priority (position 1 of 2)
    expect(result.schedule[0].split.originalTaskId).toBe('task-1');
    expect(result.schedule[1].split.originalTaskId).toBe('task-2');
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
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(6);

    // First 4 blocks should be on day 1 (8 hours)
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    const day2 = result.schedule.filter(s => s.startTime.getDate() === 16);

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
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(1);
    // Should start at 2 PM (14:00)
    expect(result.schedule[0].startTime.getHours()).toBe(14);
    expect(result.schedule[0].startTime.getMinutes()).toBe(0);
  });

  it('moves to next day if past work hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T18:00:00'); // 6 PM - after 8h workday
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0].startTime.getDate()).toBe(16); // Next day
  });

  it('respects maxDaysAhead limit', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours = 12.5 work days
    });

    const limitedConfig = { ...config, maxDaysAhead: 5 };
    const splits = TaskSplitter.splitTask(task, 120, limitedConfig);

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, limitedConfig, allTags, [], startTime);

    // Should stop before scheduling all blocks
    expect(result.schedule.length).toBeLessThan(splits.length);

    // Check that all scheduled blocks are within 5 days
    const lastDate = result.schedule[result.schedule.length - 1].startTime;
    const daysDiff = (lastDate - startTime) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeLessThan(5);
  });

  it('returns empty schedule for empty splits', () => {
    const result = AutoPlanner.schedule([], config, allTags, []);
    expect(result.schedule).toHaveLength(0);
    expect(result.deadlineMisses).toHaveLength(0);
  });

  it('includes urgency information in schedule', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule[0].urgency).toBeDefined();
    expect(result.schedule[0].urgencyComponents).toBeDefined();
    expect(result.schedule[0].urgencyComponents.tag).toBeDefined();
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
    const result = AutoPlanner.schedule(splits, tagConfig, allTagsList, [], startTime);

    // Urgent task should be scheduled first despite being second in list
    expect(result.schedule[0].split.originalTaskId).toBe('task-2');
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
    const result = AutoPlanner.schedule(splits, longTaskConfig, [], [], startTime);

    // Short task should be scheduled first due to inverse duration formula
    expect(result.schedule[0].split.originalTaskId).toBe('short');
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
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have 12 blocks (24h / 2h)
    expect(result.schedule.length).toBe(12);

    // Check that no blocks are scheduled on Saturday (13) or Sunday (14)
    const scheduledDays = result.schedule.map(s => ({
      date: s.startTime.getDate(),
      day: s.startTime.getDay()
    }));

    // Should not have any Saturday (6) or Sunday (0)
    expect(scheduledDays.every(d => d.day !== 0 && d.day !== 6)).toBe(true);

    // First 4 blocks on Friday (12), next 4 on Monday (15), last 4 on Tuesday (16)
    const fridayBlocks = result.schedule.filter(s => s.startTime.getDate() === 12);
    const mondayBlocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    const tuesdayBlocks = result.schedule.filter(s => s.startTime.getDate() === 16);

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
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    // Should be scheduled on Monday Jan 15
    expect(result.schedule[0].startTime.getDate()).toBe(15);
    expect(result.schedule[0].startTime.getDay()).toBe(1); // Monday
  });

  it('handles starting on Sunday', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Sunday Jan 14, 2024
    const startTime = new Date('2024-01-14T10:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    // Should be scheduled on Monday Jan 15
    expect(result.schedule[0].startTime.getDate()).toBe(15);
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
    const result = AutoPlanner.schedule(splits, noSkipConfig, [], [], startTime);

    // Should schedule on Friday (4 blocks) and Saturday (4 blocks)
    const fridayBlocks = result.schedule.filter(s => s.startTime.getDate() === 12);
    const saturdayBlocks = result.schedule.filter(s => s.startTime.getDate() === 13);

    expect(fridayBlocks.length).toBe(4);
    expect(saturdayBlocks.length).toBe(4);
  });
});

describe('AutoPlanner.getDateKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T10:30:00');
    expect(AutoPlanner.getDateKey(date)).toBe('2024-01-15');
  });

  it('pads month and day with zeros', () => {
    const date = new Date('2024-03-05T10:30:00');
    expect(AutoPlanner.getDateKey(date)).toBe('2024-03-05');
  });
});

describe('AutoPlanner.calculateFixedMinutesPerDay', () => {
  it('returns empty object for no fixed tasks', () => {
    const result = AutoPlanner.calculateFixedMinutesPerDay([]);
    expect(result).toEqual({});
  });

  it('calculates minutes for a single fixed task', () => {
    const fixedTasks = [{
      id: 'fixed-1',
      title: 'Fixed Task',
      dueWithTime: new Date('2024-01-15T14:00:00').getTime(),
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours = 120 minutes
    }];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result['2024-01-15']).toBe(120);
  });

  it('sums multiple fixed tasks on the same day', () => {
    const fixedTasks = [
      {
        id: 'fixed-1',
        dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
        timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
      },
      {
        id: 'fixed-2',
        dueWithTime: new Date('2024-01-15T14:00:00').getTime(),
        timeEstimate: 1 * 60 * 60 * 1000, // 1 hour
      },
    ];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result['2024-01-15']).toBe(180); // 3 hours
  });

  it('handles fixed tasks on different days', () => {
    const fixedTasks = [
      {
        id: 'fixed-1',
        dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
        timeEstimate: 2 * 60 * 60 * 1000,
      },
      {
        id: 'fixed-2',
        dueWithTime: new Date('2024-01-16T10:00:00').getTime(),
        timeEstimate: 3 * 60 * 60 * 1000,
      },
    ];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result['2024-01-15']).toBe(120);
    expect(result['2024-01-16']).toBe(180);
  });

  it('ignores tasks without dueWithTime', () => {
    const fixedTasks = [{
      id: 'fixed-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      // no dueWithTime
    }];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result).toEqual({});
  });

  it('ignores tasks without timeEstimate', () => {
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
      // no timeEstimate
    }];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result).toEqual({});
  });
});

describe('AutoPlanner.schedule with fixed tasks', () => {
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    workdayStartHour: 9,
    workdayHours: 6, // 6-hour workday for easier testing
    skipDays: [0, 6],
  };

  it('reduces available time on days with fixed tasks', () => {
    // Create a task that needs 6 hours (fills a whole day normally)
    const task = createTask({
      id: 'task-1',
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
    });

    // Fixed task takes 4 hours on Jan 15
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, config); // 2-hour blocks = 3 splits
    const startTime = new Date('2024-01-15T09:00:00'); // Monday
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(3);

    // Jan 15 has only 2 hours available (6 - 4 = 2), so only 1 block fits
    const jan15Blocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(jan15Blocks.length).toBe(1);

    // Remaining 2 blocks should be on Jan 16
    const jan16Blocks = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(jan16Blocks.length).toBe(2);
  });

  it('skips days entirely filled by fixed tasks', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
    });

    // Fixed task takes entire 6-hour day on Jan 15
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T09:00:00').getTime(),
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(1);
    // Should skip Jan 15 entirely and schedule on Jan 16
    expect(result.schedule[0].startTime.getDate()).toBe(16);
  });

  it('handles fixed tasks that exceed workday hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    // Fixed task takes more than available (7 hours > 6 hour workday)
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T09:00:00').getTime(),
      timeEstimate: 7 * 60 * 60 * 1000, // 7 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(1);
    // Should skip to next day
    expect(result.schedule[0].startTime.getDate()).toBe(16);
  });

  it('works normally when no fixed tasks provided', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    
    // Call with empty fixed tasks array
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, []);

    expect(result.schedule.length).toBe(2);
    // All should be on the same day
    expect(result.schedule[0].startTime.getDate()).toBe(15);
    expect(result.schedule[1].startTime.getDate()).toBe(15);
  });

  it('handles multiple days with varying fixed task loads', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 10 * 60 * 60 * 1000, // 10 hours
    });

    const fixedTasks = [
      {
        id: 'fixed-1',
        dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
        timeEstimate: 4 * 60 * 60 * 1000, // 4 hours on Jan 15
      },
      {
        id: 'fixed-2',
        dueWithTime: new Date('2024-01-16T10:00:00').getTime(),
        timeEstimate: 2 * 60 * 60 * 1000, // 2 hours on Jan 16
      },
    ];

    const splits = TaskSplitter.splitTask(task, 120, config); // 5 blocks of 2 hours
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(5);

    // Jan 15: 6h - 4h fixed = 2h available = 1 block
    const jan15Blocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(jan15Blocks.length).toBe(1);

    // Jan 16: 6h - 2h fixed = 4h available = 2 blocks
    const jan16Blocks = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(jan16Blocks.length).toBe(2);

    // Jan 17: 6h - 0h fixed = 6h available = remaining 2 blocks
    const jan17Blocks = result.schedule.filter(s => s.startTime.getDate() === 17);
    expect(jan17Blocks.length).toBe(2);
  });
});

describe('AutoPlanner.schedule with deadlines', () => {
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    deadlineFormula: 'linear',
    deadlineWeight: 12,
    workdayStartHour: 9,
    workdayHours: 8,
    skipDays: [],
  };

  it('prioritizes tasks with closer deadlines', () => {
    // Two tasks: one due soon, one due later
    const tasks = [
      createTask({ 
        id: 'later', 
        title: 'Later Task', 
        timeEstimate: 2 * 60 * 60 * 1000,
        dueDate: new Date('2024-01-25').getTime(), // 10 days away
      }),
      createTask({ 
        id: 'sooner', 
        title: 'Sooner Task', 
        timeEstimate: 2 * 60 * 60 * 1000,
        dueDate: new Date('2024-01-17').getTime(), // 2 days away
      }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, config));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Sooner task should be scheduled first despite being second in list
    expect(result.schedule[0].split.originalTaskId).toBe('sooner');
  });

  it('detects tasks that will miss their deadlines', () => {
    // Task with deadline but too much work to complete in time
    const task = createTask({
      id: 'task-1',
      title: 'Big Task',
      timeEstimate: 20 * 60 * 60 * 1000, // 20 hours = 2.5 work days
      dueDate: new Date('2024-01-16T17:00:00').getTime(), // Due end of tomorrow
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have deadline misses
    expect(result.deadlineMisses.length).toBeGreaterThan(0);
    expect(result.deadlineMisses[0].taskId).toBe('task-1');
    expect(result.deadlineMisses[0].taskTitle).toBe('Big Task');
  });

  it('returns no deadline misses when task can be completed on time', () => {
    // Small task with distant deadline
    const task = createTask({
      id: 'task-1',
      title: 'Small Task',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
      dueDate: new Date('2024-01-25').getTime(), // 10 days away
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have no deadline misses
    expect(result.deadlineMisses.length).toBe(0);
  });

  it('includes deadline urgency component in schedule items', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      dueDate: new Date('2024-01-20').getTime(), // 5 days away
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule[0].urgencyComponents.deadline).toBeGreaterThan(0);
  });

  it('tracks unscheduled splits for tasks that exceed maxDaysAhead', () => {
    // Task with deadline and too much work for limited scheduling window
    const task = createTask({
      id: 'task-1',
      title: 'Huge Task',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours
      dueDate: new Date('2024-02-01').getTime(),
    });

    const limitedConfig = { ...config, maxDaysAhead: 3 };
    const splits = TaskSplitter.splitTask(task, 120, limitedConfig);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, limitedConfig, [], [], startTime);

    // Should have deadline miss with unscheduled splits
    expect(result.deadlineMisses.length).toBeGreaterThan(0);
    expect(result.deadlineMisses[0].unscheduledSplits).toBeGreaterThan(0);
  });
});

describe('AutoPlanner.scheduleWithAutoAdjust', () => {
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: { urgent: 50 },
    durationFormula: 'none',
    oldnessFormula: 'none',
    deadlineFormula: 'linear',
    deadlineWeight: 12,
    autoAdjustUrgency: true,
    urgencyWeight: 1.0,
    workdayStartHour: 9,
    workdayHours: 8,
    skipDays: [],
  };

  it('returns schedule without adjustment when no deadline misses', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      notes: 'Due: 2024-01-25', // Plenty of time
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    expect(result.deadlineMisses.length).toBe(0);
    expect(result.finalUrgencyWeight).toBe(1.0);
    expect(result.adjustmentAttempts).toBe(0);
  });

  it('adjusts urgency weight when deadline cannot be met', () => {
    // Create two tasks: one urgent with tag boost, one with tight deadline
    // With full urgency weight, the urgent task gets scheduled first,
    // causing the deadline task to miss its deadline.
    // With reduced urgency weight, deadline priority takes over.
    const tasks = [
      createTask({
        id: 'urgent-task',
        title: 'Urgent',
        timeEstimate: 8 * 60 * 60 * 1000, // 8 hours (full day)
        tagIds: ['tag-urgent'],
      }),
      createTask({
        id: 'deadline-task',
        title: 'Deadline',
        timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
        notes: 'Due: 2024-01-15', // Due today!
      }),
    ];

    const allTags = [{ id: 'tag-urgent', name: 'urgent' }];

    let allSplits = [];
    for (const task of tasks) {
      allSplits.push(...TaskSplitter.splitTask(task, 120, config));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(allSplits, config, allTags, [], startTime);

    // Auto-adjust should have kicked in to prioritize the deadline task
    expect(result.finalUrgencyWeight).toBeLessThan(1.0);
    expect(result.adjustmentAttempts).toBeGreaterThan(0);
  });

  it('does not adjust when autoAdjustUrgency is false', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 20 * 60 * 60 * 1000, // 20 hours
      notes: 'Due: 2024-01-16', // Due tomorrow - will miss
    });

    const noAdjustConfig = { ...config, autoAdjustUrgency: false, maxDaysAhead: 1 };
    const splits = TaskSplitter.splitTask(task, 120, noAdjustConfig);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(splits, noAdjustConfig, [], [], startTime);

    // Should not attempt adjustment
    expect(result.adjustmentAttempts).toBe(0);
    expect(result.finalUrgencyWeight).toBe(1.0);
    // Should still have deadline miss
    expect(result.deadlineMisses.length).toBeGreaterThan(0);
  });

  it('stops adjusting when weight reaches 0', () => {
    // Task that cannot be scheduled before deadline no matter what
    const task = createTask({
      id: 'task-1',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours = 12.5 days
      notes: 'Due: 2024-01-16', // Due tomorrow
    });

    const maxDayConfig = { ...config, maxDaysAhead: 2 };
    const splits = TaskSplitter.splitTask(task, 120, maxDayConfig);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(splits, maxDayConfig, [], [], startTime);

    // Should have tried all adjustments down to 0
    expect(result.finalUrgencyWeight).toBe(0);
  });
});
