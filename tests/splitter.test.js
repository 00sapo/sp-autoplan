/**
 * Tests for TaskSplitter module
 */

import { describe, it, expect } from 'vitest';
import { TaskSplitter, DEFAULT_CONFIG } from '../src/core.js';

// Helper to create a task
function createTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    timeSpent: 0,
    tagIds: ['tag-1'],
    projectId: 'project-1',
    parentId: null,
    created: Date.now(),
    isDone: false,
    notes: '',
    ...overrides,
  };
}

describe('TaskSplitter.splitTask', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('splits a 4-hour task into 2 blocks (default 2h blocks)', () => {
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(2);
    expect(splits[0].estimatedHours).toBe(2);
    expect(splits[1].estimatedHours).toBe(2);
  });

  it('handles tasks smaller than block size', () => {
    const task = createTask({ timeEstimate: 1 * 60 * 60 * 1000 }); // 1 hour
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(1);
    expect(splits[0].estimatedHours).toBe(1);
  });

  it('handles partial last block', () => {
    const task = createTask({ timeEstimate: 5 * 60 * 60 * 1000 }); // 5 hours
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(3);
    expect(splits[0].estimatedHours).toBe(2);
    expect(splits[1].estimatedHours).toBe(2);
    expect(splits[2].estimatedHours).toBe(1);
  });

  it('adds Roman numeral suffixes', () => {
    const task = createTask({ timeEstimate: 6 * 60 * 60 * 1000 }); // 6 hours
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].title).toBe('Test Task <I>');
    expect(splits[1].title).toBe('Test Task <II>');
    expect(splits[2].title).toBe('Test Task <III>');
  });

  it('respects splitSuffix = false', () => {
    const noSuffixConfig = { ...config, splitSuffix: false };
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, noSuffixConfig);

    expect(splits[0].title).toBe('Test Task');
    expect(splits[1].title).toBe('Test Task');
  });

  it('applies splitPrefix', () => {
    const prefixConfig = { ...config, splitPrefix: '[SPLIT] ' };
    const task = createTask({ timeEstimate: 2 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, prefixConfig);

    expect(splits[0].title).toBe('[SPLIT] Test Task <I>');
  });

  it('preserves task metadata', () => {
    const task = createTask({
      id: 'my-task',
      tagIds: ['tag-a', 'tag-b'],
      projectId: 'proj-123',
      parentId: 'parent-1',
    });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].originalTaskId).toBe('my-task');
    expect(splits[0].tagIds).toEqual(['tag-a', 'tag-b']);
    expect(splits[0].projectId).toBe('proj-123');
    expect(splits[0].parentId).toBe('parent-1');
  });

  it('sets correct split indices and links', () => {
    const task = createTask({ timeEstimate: 6 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].splitIndex).toBe(0);
    expect(splits[0].totalSplits).toBe(3);
    expect(splits[0].prevSplitIndex).toBe(null);
    expect(splits[0].nextSplitIndex).toBe(1);

    expect(splits[1].splitIndex).toBe(1);
    expect(splits[1].prevSplitIndex).toBe(0);
    expect(splits[1].nextSplitIndex).toBe(2);

    expect(splits[2].splitIndex).toBe(2);
    expect(splits[2].prevSplitIndex).toBe(1);
    expect(splits[2].nextSplitIndex).toBe(null);
  });

  it('returns empty array for task with no remaining time', () => {
    const task = createTask({
      timeEstimate: 2 * 60 * 60 * 1000,
      timeSpent: 2 * 60 * 60 * 1000,
    });
    const splits = TaskSplitter.splitTask(task, 120, config);
    expect(splits).toHaveLength(0);
  });

  it('returns empty array for task with more time spent than estimated', () => {
    const task = createTask({
      timeEstimate: 2 * 60 * 60 * 1000,
      timeSpent: 3 * 60 * 60 * 1000,
    });
    const splits = TaskSplitter.splitTask(task, 120, config);
    expect(splits).toHaveLength(0);
  });

  it('handles zero/negative block size by using default', () => {
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    
    const splits0 = TaskSplitter.splitTask(task, 0, config);
    expect(splits0).toHaveLength(2); // Uses default 120 min
    
    const splitsNeg = TaskSplitter.splitTask(task, -60, config);
    expect(splitsNeg).toHaveLength(2);
  });
});

describe('TaskSplitter.isAlreadyProcessed', () => {
  it('detects tasks already processed by AutoPlan', () => {
    const processed = createTask({
      notes: 'Some notes\n\n[AutoPlan] This task was split.',
    });
    expect(TaskSplitter.isAlreadyProcessed(processed)).toBe(true);
  });

  it('returns false for unprocessed tasks', () => {
    const unprocessed = createTask({ notes: 'Regular notes' });
    expect(TaskSplitter.isAlreadyProcessed(unprocessed)).toBe(false);
  });

  it('handles tasks without notes', () => {
    const noNotes = createTask({ notes: null });
    expect(TaskSplitter.isAlreadyProcessed(noNotes)).toBe(false);
  });
});

describe('TaskSplitter.processAllTasks', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('processes multiple tasks', () => {
    const tasks = [
      createTask({ id: 'task-1', timeEstimate: 4 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits, skippedParents, alreadyProcessed } = 
      TaskSplitter.processAllTasks(tasks, 120, config);

    expect(splits).toHaveLength(3); // 2 splits from task-1, 1 from task-2
    expect(skippedParents).toHaveLength(0);
    expect(alreadyProcessed).toHaveLength(0);
  });

  it('skips parent tasks with subtasks', () => {
    const tasks = [
      createTask({ id: 'parent', timeEstimate: 4 * 60 * 60 * 1000 }),
      createTask({ id: 'child', parentId: 'parent', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits, skippedParents } = TaskSplitter.processAllTasks(tasks, 120, config);

    expect(splits).toHaveLength(1); // Only child task
    expect(skippedParents).toHaveLength(1);
    expect(skippedParents[0].id).toBe('parent');
  });

  it('skips completed tasks', () => {
    const tasks = [
      createTask({ id: 'task-1', isDone: true, timeEstimate: 4 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', isDone: false, timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits } = TaskSplitter.processAllTasks(tasks, 120, config);
    expect(splits).toHaveLength(1);
    expect(splits[0].originalTaskId).toBe('task-2');
  });

  it('skips already processed tasks', () => {
    const tasks = [
      createTask({
        id: 'task-1',
        timeEstimate: 4 * 60 * 60 * 1000,
        notes: '[AutoPlan] Already processed',
      }),
      createTask({ id: 'task-2', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits, alreadyProcessed } = TaskSplitter.processAllTasks(tasks, 120, config);

    expect(splits).toHaveLength(1);
    expect(alreadyProcessed).toHaveLength(1);
    expect(alreadyProcessed[0].id).toBe('task-1');
  });

  it('handles empty task list', () => {
    const { splits, skippedParents, alreadyProcessed } = 
      TaskSplitter.processAllTasks([], 120, config);

    expect(splits).toHaveLength(0);
    expect(skippedParents).toHaveLength(0);
    expect(alreadyProcessed).toHaveLength(0);
  });

  it('skips tasks without time estimate', () => {
    const tasks = [
      createTask({ id: 'task-1', timeEstimate: 0 }),
      createTask({ id: 'task-2', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits } = TaskSplitter.processAllTasks(tasks, 120, config);
    expect(splits).toHaveLength(1);
    expect(splits[0].originalTaskId).toBe('task-2');
  });
});
