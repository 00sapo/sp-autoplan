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

describe('TaskMerger.generateSplitNotes', () => {
  it('generates correctly formatted notes', () => {
    const notes = TaskMerger.generateSplitNotes(0, 3, 'My Task', 'original-123');
    expect(notes).toBe('Split 1/3 of "My Task"\n\nOriginal Task ID: original-123');
  });

  it('escapes special characters in title', () => {
    const notes = TaskMerger.generateSplitNotes(1, 2, 'Task "with quotes"', 'orig-1');
    expect(notes).toContain('Task \\"with quotes\\"');
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
      notes: 'Split 1/2 of "Task \\"important\\""\n\nOriginal Task ID: orig-1',
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

  it('handles complex original task IDs', () => {
    const task = createTask({
      notes: 'Split 1/2 of "Task"\n\nOriginal Task ID: abc-123-def-456',
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
  it('calculates total time from incomplete splits', () => {
    const splits = [
      createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpent: 30 * 60 * 1000 }),
      createTask({ timeEstimate: 2 * 60 * 60 * 1000, timeSpent: 60 * 60 * 1000 }),
    ];

    const data = TaskMerger.calculateMergeData(splits, 'Original Task');

    expect(data.totalTimeEstimate).toBe(4 * 60 * 60 * 1000);
    expect(data.totalTimeSpent).toBe(90 * 60 * 1000);
    expect(data.mergedCount).toBe(2);
  });

  it('uses provided original title', () => {
    const splits = [createTask({ title: 'Task <I>' })];
    const data = TaskMerger.calculateMergeData(splits, 'My Original Task');

    expect(data.title).toBe('My Original Task');
  });

  it('removes Roman numeral suffix when no original title', () => {
    const splits = [createTask({ title: 'Task Name <III>' })];
    const data = TaskMerger.calculateMergeData(splits, null);

    expect(data.title).toBe('Task Name');
  });

  it('handles single split', () => {
    const splits = [createTask({ timeEstimate: 2 * 60 * 60 * 1000 })];
    const data = TaskMerger.calculateMergeData(splits, 'Task');

    expect(data.mergedCount).toBe(1);
  });

  it('handles empty array', () => {
    const data = TaskMerger.calculateMergeData([], 'Task');

    expect(data.totalTimeEstimate).toBe(0);
    expect(data.totalTimeSpent).toBe(0);
    expect(data.mergedCount).toBe(0);
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
