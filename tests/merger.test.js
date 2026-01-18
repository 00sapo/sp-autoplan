/**
 * Tests for TaskMerger module
 */

import { describe, it, expect } from 'vitest';
import { TaskMerger } from '../src/core.js';

// Helper to create a task
function createTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    timeEstimate: 2 * 60 * 60 * 1000,
    timeSpent: 0,
    tagIds: [],
    isDone: false,
    notes: '',
    ...overrides,
  };
}

// Helper to create a split task with proper notes
function createSplitTask(originalId, originalTitle, splitIndex, totalSplits, overrides = {}) {
  const notes = TaskMerger.generateSplitNotes(splitIndex, totalSplits, originalTitle, originalId);
  return createTask({
    id: `${originalId}-split-${splitIndex}`,
    title: `${originalTitle} ${['I', 'II', 'III', 'IV', 'V'][splitIndex]}`,
    notes,
    ...overrides,
  });
}

describe('TaskMerger.escapeTitle', () => {
  it('escapes quotes in title', () => {
    expect(TaskMerger.escapeTitle('Task "important"')).toBe('Task \\"important\\"');
  });

  it('handles title without quotes', () => {
    expect(TaskMerger.escapeTitle('Normal Task')).toBe('Normal Task');
  });

  it('handles multiple quotes', () => {
    expect(TaskMerger.escapeTitle('"A" and "B"')).toBe('\\"A\\" and \\"B\\"');
  });
});

describe('TaskMerger.cleanAutoplanNotes', () => {
  it('removes [AutoPlan] lines from notes', () => {
    const notes = '[AutoPlan] Merged from 3 split tasks.\n\nOriginal Task ID: abc123';
    const cleaned = TaskMerger.cleanAutoplanNotes(notes);
    expect(cleaned).toBe('');
  });

  it('removes Split X/Y lines from notes', () => {
    const notes = 'Split 1/3 of "My Task"\n\nOriginal Task ID: abc123';
    const cleaned = TaskMerger.cleanAutoplanNotes(notes);
    expect(cleaned).toBe('');
  });

  it('preserves user notes while removing AutoPlan markers', () => {
    const notes = 'User note here\n\n[AutoPlan] Merged from 2 split tasks.\n\nOriginal Task ID: abc123\n\nAnother user note';
    const cleaned = TaskMerger.cleanAutoplanNotes(notes);
    expect(cleaned).toBe('User note here\n\n\n\nAnother user note');
  });

  it('handles empty notes', () => {
    expect(TaskMerger.cleanAutoplanNotes('')).toBe('');
    expect(TaskMerger.cleanAutoplanNotes(null)).toBe('');
    expect(TaskMerger.cleanAutoplanNotes(undefined)).toBe('');
  });

  it('handles notes without AutoPlan markers', () => {
    const notes = 'This is a normal note\nWith multiple lines';
    const cleaned = TaskMerger.cleanAutoplanNotes(notes);
    expect(cleaned).toBe('This is a normal note\nWith multiple lines');
  });

  it('removes multiple AutoPlan markers', () => {
    const notes = '[AutoPlan] First marker\nSplit 2/4 of "Task"\nOriginal Task ID: xyz\n[AutoPlan] Second marker';
    const cleaned = TaskMerger.cleanAutoplanNotes(notes);
    expect(cleaned).toBe('');
  });
});

describe('TaskMerger.generateSplitNotes', () => {
  it('generates correctly formatted notes with AutoPlan markers', () => {
    const notes = TaskMerger.generateSplitNotes(0, 3, 'My Task', 'original-123');
    expect(notes).toBe('[AutoPlan] Split 1/3 of "My Task"\n\n[AutoPlan] Original Task ID: original-123');
  });

  it('escapes special characters in title', () => {
    const notes = TaskMerger.generateSplitNotes(1, 2, 'Task "with quotes"', 'orig-1');
    expect(notes).toContain('Task \\"with quotes\\"');
    expect(notes).toContain('[AutoPlan]');
  });

  it('preserves existing user notes', () => {
    const existingNotes = 'Deadline: 2024-06-15\nImportant context here';
    const notes = TaskMerger.generateSplitNotes(0, 2, 'My Task', 'orig-1', existingNotes);
    expect(notes).toContain('Deadline: 2024-06-15');
    expect(notes).toContain('Important context here');
    expect(notes).toContain('[AutoPlan] Split 1/2');
    expect(notes).toContain('[AutoPlan] Original Task ID: orig-1');
  });

  it('puts user notes before AutoPlan markers', () => {
    const existingNotes = 'User note';
    const notes = TaskMerger.generateSplitNotes(0, 2, 'My Task', 'orig-1', existingNotes);
    const userNoteIndex = notes.indexOf('User note');
    const autoplanIndex = notes.indexOf('[AutoPlan]');
    expect(userNoteIndex).toBeLessThan(autoplanIndex);
  });

  it('cleans existing AutoPlan markers from notes to avoid duplication', () => {
    const existingNotes = 'User note\n\n[AutoPlan] Split 1/2 of "Old Task"\n\n[AutoPlan] Original Task ID: old-id';
    const notes = TaskMerger.generateSplitNotes(1, 3, 'New Task', 'new-id', existingNotes);
    expect(notes).toContain('User note');
    expect(notes).toContain('[AutoPlan] Split 2/3 of "New Task"');
    expect(notes).toContain('[AutoPlan] Original Task ID: new-id');
    // Should not contain old markers
    expect(notes).not.toContain('Split 1/2');
    expect(notes).not.toContain('old-id');
  });

  it('handles empty existing notes', () => {
    const notes = TaskMerger.generateSplitNotes(0, 2, 'My Task', 'orig-1', '');
    expect(notes).toBe('[AutoPlan] Split 1/2 of "My Task"\n\n[AutoPlan] Original Task ID: orig-1');
  });

  it('handles null/undefined existing notes', () => {
    const notesNull = TaskMerger.generateSplitNotes(0, 2, 'My Task', 'orig-1', null);
    const notesUndef = TaskMerger.generateSplitNotes(0, 2, 'My Task', 'orig-1', undefined);
    expect(notesNull).toBe('[AutoPlan] Split 1/2 of "My Task"\n\n[AutoPlan] Original Task ID: orig-1');
    expect(notesUndef).toBe('[AutoPlan] Split 1/2 of "My Task"\n\n[AutoPlan] Original Task ID: orig-1');
  });
});

describe('TaskMerger.parseSplitInfo', () => {
  it('parses standard split notes', () => {
    const task = createSplitTask('orig-1', 'My Task', 2, 5);
    const info = TaskMerger.parseSplitInfo(task);

    expect(info).not.toBeNull();
    expect(info.splitIndex).toBe(2);
    expect(info.totalSplits).toBe(5);
    expect(info.originalTitle).toBe('My Task');
    expect(info.originalTaskId).toBe('orig-1');
  });

  it('handles titles with escaped quotes', () => {
    const task = createTask({
      notes: '[AutoPlan] Split 1/2 of "Task \\"important\\""\n\n[AutoPlan] Original Task ID: orig-1',
    });
    const info = TaskMerger.parseSplitInfo(task);

    expect(info).not.toBeNull();
    expect(info.originalTitle).toBe('Task "important"');
  });

  it('returns null for non-split tasks', () => {
    const task = createTask({ notes: 'Regular notes' });
    expect(TaskMerger.parseSplitInfo(task)).toBeNull();
  });

  it('returns null for tasks without notes', () => {
    const task = createTask({ notes: null });
    expect(TaskMerger.parseSplitInfo(task)).toBeNull();

    const task2 = createTask({ notes: undefined });
    expect(TaskMerger.parseSplitInfo(task2)).toBeNull();
  });

  it('returns null for malformed notes', () => {
    const task = createTask({ notes: 'Split 1/3 but missing rest' });
    expect(TaskMerger.parseSplitInfo(task)).toBeNull();
  });

  it('prevents false positives - rejects notes without [AutoPlan] prefix', () => {
    // User notes that look like split task notes but don't have [AutoPlan] prefix
    const task1 = createTask({
      notes: 'Split 1/2 of "my work" into smaller parts.\nOriginal Task ID: some-id-in-notes'
    });
    const task2 = createTask({
      notes: 'Meeting notes: Split 3/5 of "project budget" between teams.\nOriginal Task ID: PROJECT-123'
    });
    
    expect(TaskMerger.parseSplitInfo(task1)).toBeNull();
    expect(TaskMerger.parseSplitInfo(task2)).toBeNull();
  });

  it('handles complex original task IDs', () => {
    const task = createTask({
      notes: '[AutoPlan] Split 1/2 of "Task"\n\n[AutoPlan] Original Task ID: abc-123-def-456',
    });
    const info = TaskMerger.parseSplitInfo(task);
    expect(info.originalTaskId).toBe('abc-123-def-456');
  });
});

describe('TaskMerger.findRelatedSplits', () => {
  it('finds all splits from same original task', () => {
    const tasks = [
      createSplitTask('orig-1', 'Task A', 0, 3, { id: 'split-1' }),
      createSplitTask('orig-1', 'Task A', 1, 3, { id: 'split-2' }),
      createSplitTask('orig-1', 'Task A', 2, 3, { id: 'split-3' }),
      createSplitTask('orig-2', 'Task B', 0, 2, { id: 'split-4' }),
    ];

    const result = TaskMerger.findRelatedSplits(tasks, 'split-1');

    expect(result.splits).toHaveLength(3);
    expect(result.originalTaskId).toBe('orig-1');
    expect(result.originalTitle).toBe('Task A');
  });

  it('sorts splits by index', () => {
    const tasks = [
      createSplitTask('orig-1', 'Task', 2, 3, { id: 'split-3' }),
      createSplitTask('orig-1', 'Task', 0, 3, { id: 'split-1' }),
      createSplitTask('orig-1', 'Task', 1, 3, { id: 'split-2' }),
    ];

    const result = TaskMerger.findRelatedSplits(tasks, 'split-3');

    expect(result.splits[0].id).toBe('split-1');
    expect(result.splits[1].id).toBe('split-2');
    expect(result.splits[2].id).toBe('split-3');
  });

  it('returns empty for non-existent task', () => {
    const tasks = [createSplitTask('orig-1', 'Task', 0, 2, { id: 'split-1' })];
    const result = TaskMerger.findRelatedSplits(tasks, 'non-existent');

    expect(result.splits).toHaveLength(0);
    expect(result.originalTaskId).toBeNull();
  });

  it('returns empty for non-split task', () => {
    const tasks = [createTask({ id: 'regular-task', notes: 'Just notes' })];
    const result = TaskMerger.findRelatedSplits(tasks, 'regular-task');

    expect(result.splits).toHaveLength(0);
  });
});

describe('TaskMerger.calculateMergeData', () => {
  it('calculates total time from incomplete splits for estimate, all splits for spent', () => {
    const incompleteSplits = [
      createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpent: 30 * 60 * 1000 }),
      createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpent: 60 * 60 * 1000 }),
    ];
    const completedSplits = [
      createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpent: 2 * 60 * 60 * 1000, isDone: true }),
    ];
    const allSplits = [...incompleteSplits, ...completedSplits];

    const data = TaskMerger.calculateMergeData(incompleteSplits, allSplits, 'Original Task');

    // Estimate only from incomplete splits
    expect(data.totalTimeEstimate).toBe(4 * 60 * 60 * 1000);
    // Time spent from ALL splits (including completed)
    expect(data.totalTimeSpent).toBe(3.5 * 60 * 60 * 1000); // 30min + 60min + 120min
    expect(data.mergedCount).toBe(2);
  });

  it('uses provided original title', () => {
    const splits = [createTask({ title: 'Task <I>' })];
    const data = TaskMerger.calculateMergeData(splits, splits, 'My Original Task');

    expect(data.title).toBe('My Original Task');
  });

  it('removes Roman numeral suffix when no original title', () => {
    const splits = [createTask({ title: 'Task Name <III>' })];
    const data = TaskMerger.calculateMergeData(splits, splits, null);

    expect(data.title).toBe('Task Name');
  });

  it('handles single split', () => {
    const splits = [createTask({ timeEstimate: 2 * 60 * 60 * 1000 })];
    const data = TaskMerger.calculateMergeData(splits, splits, 'Task');

    expect(data.mergedCount).toBe(1);
  });

  it('handles empty array', () => {
    const data = TaskMerger.calculateMergeData([], [], 'Task');

    expect(data.totalTimeEstimate).toBe(0);
    expect(data.totalTimeSpent).toBe(0);
    expect(data.mergedCount).toBe(0);
  });

  it('includes time spent from completed splits only', () => {
    const incompleteSplits = [];
    const completedSplits = [
      createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpent: 2 * 60 * 60 * 1000, isDone: true }),
    ];

    const data = TaskMerger.calculateMergeData(incompleteSplits, completedSplits, 'Task');

    expect(data.totalTimeEstimate).toBe(0); // No incomplete splits
    expect(data.totalTimeSpent).toBe(2 * 60 * 60 * 1000); // From completed split
    expect(data.mergedCount).toBe(0);
  });

  it('merges timeSpentOnDay from all splits', () => {
    const split1 = createTask({ 
      timeEstimate: 2 * 60 * 60 * 1000, 
      timeSpentOnDay: { '2024-01-15': 30 * 60 * 1000, '2024-01-16': 60 * 60 * 1000 }
    });
    const split2 = createTask({ 
      timeEstimate: 2 * 60 * 60 * 1000, 
      timeSpentOnDay: { '2024-01-16': 30 * 60 * 1000, '2024-01-17': 45 * 60 * 1000 }
    });
    const allSplits = [split1, split2];

    const data = TaskMerger.calculateMergeData(allSplits, allSplits, 'Task');

    expect(data.totalTimeSpentOnDay).toEqual({
      '2024-01-15': 30 * 60 * 1000,
      '2024-01-16': 90 * 60 * 1000, // 60 + 30
      '2024-01-17': 45 * 60 * 1000,
    });
  });

  it('handles splits with empty or missing timeSpentOnDay', () => {
    const split1 = createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpentOnDay: { '2024-01-15': 30 * 60 * 1000 } });
    const split2 = createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpentOnDay: {} });
    const split3 = createTask({ timeEstimate: 2 * 60 * 60 * 1000 }); // no timeSpentOnDay
    const allSplits = [split1, split2, split3];

    const data = TaskMerger.calculateMergeData(allSplits, allSplits, 'Task');

    expect(data.totalTimeSpentOnDay).toEqual({
      '2024-01-15': 30 * 60 * 1000,
    });
  });
});

describe('TaskMerger.mergeTimeSpentOnDay', () => {
  it('merges multiple timeSpentOnDay objects', () => {
    const result = TaskMerger.mergeTimeSpentOnDay([
      { '2024-01-15': 1000, '2024-01-16': 2000 },
      { '2024-01-16': 500, '2024-01-17': 3000 },
    ]);

    expect(result).toEqual({
      '2024-01-15': 1000,
      '2024-01-16': 2500,
      '2024-01-17': 3000,
    });
  });

  it('handles empty array', () => {
    const result = TaskMerger.mergeTimeSpentOnDay([]);
    expect(result).toEqual({});
  });

  it('handles null and undefined entries', () => {
    const result = TaskMerger.mergeTimeSpentOnDay([
      null,
      undefined,
      { '2024-01-15': 1000 },
    ]);

    expect(result).toEqual({ '2024-01-15': 1000 });
  });

  it('handles empty objects', () => {
    const result = TaskMerger.mergeTimeSpentOnDay([{}, {}, { '2024-01-15': 500 }]);
    expect(result).toEqual({ '2024-01-15': 500 });
  });
});

describe('TaskMerger.findAllSplitGroups', () => {
  it('groups splits by original task', () => {
    const tasks = [
      createSplitTask('orig-1', 'Task A', 0, 2, { id: 'a-1' }),
      createSplitTask('orig-1', 'Task A', 1, 2, { id: 'a-2' }),
      createSplitTask('orig-2', 'Task B', 0, 3, { id: 'b-1' }),
      createSplitTask('orig-2', 'Task B', 1, 3, { id: 'b-2' }),
      createSplitTask('orig-2', 'Task B', 2, 3, { id: 'b-3' }),
      createTask({ id: 'regular', notes: 'Not a split' }),
    ];

    const groups = TaskMerger.findAllSplitGroups(tasks);

    expect(groups).toHaveLength(2);

    const groupA = groups.find(g => g.originalTaskId === 'orig-1');
    const groupB = groups.find(g => g.originalTaskId === 'orig-2');

    expect(groupA.splits).toHaveLength(2);
    expect(groupA.originalTitle).toBe('Task A');

    expect(groupB.splits).toHaveLength(3);
    expect(groupB.originalTitle).toBe('Task B');
  });

  it('sorts splits within each group', () => {
    const tasks = [
      createSplitTask('orig-1', 'Task', 2, 3, { id: 's-3' }),
      createSplitTask('orig-1', 'Task', 0, 3, { id: 's-1' }),
      createSplitTask('orig-1', 'Task', 1, 3, { id: 's-2' }),
    ];

    const groups = TaskMerger.findAllSplitGroups(tasks);

    expect(groups[0].splits[0].splitInfo.splitIndex).toBe(0);
    expect(groups[0].splits[1].splitInfo.splitIndex).toBe(1);
    expect(groups[0].splits[2].splitInfo.splitIndex).toBe(2);
  });

  it('returns empty array when no splits exist', () => {
    const tasks = [
      createTask({ id: 'task-1', notes: 'Regular' }),
      createTask({ id: 'task-2', notes: null }),
    ];

    const groups = TaskMerger.findAllSplitGroups(tasks);
    expect(groups).toHaveLength(0);
  });

  it('handles empty task list', () => {
    const groups = TaskMerger.findAllSplitGroups([]);
    expect(groups).toHaveLength(0);
  });
});
