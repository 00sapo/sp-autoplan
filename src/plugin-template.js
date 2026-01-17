// ============================================================================
// PLUGIN-SPECIFIC EXTENSIONS (uses PluginAPI)
// These methods extend the core library with Super Productivity integration
// ============================================================================

/**
 * Get scheduling fields for a task based on its scheduled time.
 * Uses dueWithTime (timestamp in milliseconds) for all tasks.
 * This ensures tasks scheduled for the future appear in Planner, not Today.
 * 
 * Note: dueDay and dueWithTime are mutually exclusive in Super Productivity.
 * When setting dueWithTime, we must clear dueDay (use undefined, not null).
 */
function getSchedulingFields(startTime) {
  return {
    dueWithTime: startTime.getTime(),
    dueDay: undefined, // Clear dueDay to avoid conflicts (use undefined per SP's internal behavior)
    hasPlannedTime: true, // Indicate this task has a specific scheduled time
  };
}

/**
 * Apply the schedule by creating/updating tasks in Super Productivity
 * This extends AutoPlanner with PluginAPI integration
 */
AutoPlanner.applySchedule = async function(schedule, originalTasks) {
  const createdTasks = [];
  const errors = [];
  const taskGroups = new Map(); // Group splits by original task

  // Group scheduled splits by original task
  for (const item of schedule) {
    const originalId = item.split.originalTaskId;
    if (!taskGroups.has(originalId)) {
      taskGroups.set(originalId, []);
    }
    taskGroups.get(originalId).push(item);
  }

  // Process each original task
  for (const [originalId, items] of taskGroups) {
    const originalTask = items[0].split.originalTask;

    // Sort items by split index
    items.sort((a, b) => a.split.splitIndex - b.split.splitIndex);

    try {
      // If only one block, just update the original task
      if (items.length === 1) {
        // Update with scheduled time using appropriate field
        const schedulingFields = getSchedulingFields(items[0].startTime);
        await PluginAPI.updateTask(originalId, schedulingFields);
        createdTasks.push({
          type: 'updated',
          taskId: originalId,
          scheduledAt: items[0].startTime,
        });
      } else {
        // Split task into multiple blocks
        // IMPORTANT: Preserve the original task as the first split to maintain task ID
        const splitTaskIds = [];
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const schedulingFields = getSchedulingFields(item.startTime);
          
          try {
            if (i === 0) {
              // First split: UPDATE the original task instead of creating a new one
              // This preserves the original task ID and keeps the timeSpent
              await PluginAPI.updateTask(originalId, {
                title: item.split.title,
                timeEstimate: item.split.estimatedMs,
                // timeSpent is preserved automatically since we're updating, not creating
                notes: TaskMerger.generateSplitNotes(
                  item.split.splitIndex,
                  item.split.totalSplits,
                  originalTask.title,
                  originalId
                ),
                ...schedulingFields,
              });

              splitTaskIds.push(originalId);
              createdTasks.push({
                type: 'updated',
                taskId: originalId,
                originalTaskId: originalId,
                splitIndex: item.split.splitIndex,
                scheduledAt: item.startTime,
              });
            } else {
              // Subsequent splits: Create new tasks with no time tracking data
              const newTaskId = await PluginAPI.addTask({
                title: item.split.title,
                timeEstimate: item.split.estimatedMs,
                timeSpent: 0, // New splits start with no time spent
                timeSpentOnDay: {}, // New splits start with empty time-on-day tracking
                tagIds: item.split.tagIds,
                projectId: item.split.projectId,
                parentId: item.split.parentId,
                notes: TaskMerger.generateSplitNotes(
                  item.split.splitIndex,
                  item.split.totalSplits,
                  originalTask.title,
                  originalId
                ),
              });

              // Set the scheduled time via updateTask using appropriate field
              await PluginAPI.updateTask(newTaskId, schedulingFields);

              splitTaskIds.push(newTaskId);
              createdTasks.push({
                type: 'created',
                taskId: newTaskId,
                originalTaskId: originalId,
                splitIndex: item.split.splitIndex,
                scheduledAt: item.startTime,
              });
            }
          } catch (splitError) {
            console.warn(`[AutoPlan] Failed to create/update split ${i} for task ${originalId}:`, splitError);
            errors.push({ taskId: originalId, splitIndex: i, error: splitError.message });
            // Continue with other splits
          }
        }
      }
    } catch (taskError) {
      console.warn(`[AutoPlan] Failed to process task ${originalId}:`, taskError);
      errors.push({ taskId: originalId, error: taskError.message });
      // Continue with other tasks
    }
  }

  if (errors.length > 0) {
    console.warn(`[AutoPlan] Completed with ${errors.length} errors:`, errors);
  }

  return { createdTasks, errors };
};

/**
 * Find all split tasks that belong to the same original task (async version)
 * This extends TaskMerger with PluginAPI integration
 */
TaskMerger.findRelatedSplitsAsync = async function(taskId) {
  const tasks = await PluginAPI.getTasks();
  return this.findRelatedSplits(tasks, taskId);
};

/**
 * Merge split tasks back into a single task
 * This extends TaskMerger with PluginAPI integration
 * 
 * @param {string} taskId - ID of any task in the split group
 * @param {boolean} silent - If true, don't show snack notifications
 */
TaskMerger.mergeSplits = async function(taskId, silent = false) {
  const tasks = await PluginAPI.getTasks();
  const { splits, originalTaskId, originalTitle } = this.findRelatedSplits(tasks, taskId);
  
  if (splits.length === 0) {
    if (!silent) {
      PluginAPI.showSnack({
        msg: 'This task is not a split task',
        type: 'WARNING',
      });
    }
    return null;
  }

  if (splits.length === 1) {
    if (!silent) {
      PluginAPI.showSnack({
        msg: 'Only one split remaining, nothing to merge',
        type: 'INFO',
      });
    }
    return null;
  }

  // Calculate total remaining time from incomplete splits
  const incompleteSplits = splits.filter(s => !s.isDone);
  if (incompleteSplits.length === 0) {
    if (!silent) {
      PluginAPI.showSnack({
        msg: 'All splits are already completed',
        type: 'INFO',
      });
    }
    return null;
  }

  // Calculate merge data - pass all splits to include time spent from completed ones
  const mergeData = this.calculateMergeData(incompleteSplits, splits, originalTitle);

  // Prefer using the original task (the one whose ID matches originalTaskId) as the merged task
  // This preserves the original task ID through the merge process
  let mergedTask = incompleteSplits.find(s => s.id === originalTaskId);
  let tasksToDelete;
  
  if (mergedTask) {
    // Original task is still present and incomplete - use it
    tasksToDelete = incompleteSplits.filter(s => s.id !== originalTaskId);
  } else {
    // Original task was completed or not found - use first incomplete split
    mergedTask = incompleteSplits[0];
    tasksToDelete = incompleteSplits.slice(1);
  }

  // Update the merged task with combined time tracking data
  await PluginAPI.updateTask(mergedTask.id, {
    title: mergeData.title,
    timeEstimate: mergeData.totalTimeEstimate,
    timeSpent: mergeData.totalTimeSpent,
    timeSpentOnDay: mergeData.totalTimeSpentOnDay,
    notes: `[AutoPlan] Merged from ${mergeData.mergedCount} split tasks.\n\nOriginal Task ID: ${originalTaskId}`,
  });

  // Delete the other incomplete splits
  for (const task of tasksToDelete) {
    try {
      await PluginAPI.deleteTask(task.id);
    } catch (e) {
      console.warn('[AutoPlan] Could not delete split task:', e);
      // Fallback: mark as done if delete fails
      try {
        await PluginAPI.updateTask(task.id, {
          isDone: true,
          notes: `${task.notes || ''}\n\n[AutoPlan] Merged into task: ${mergedTask.id}`,
        });
      } catch (e2) {
        console.warn('[AutoPlan] Could not mark task as done:', e2);
      }
    }
  }

  // Also delete any completed splits from this group
  const completedSplits = splits.filter(s => s.isDone);
  for (const task of completedSplits) {
    try {
      await PluginAPI.deleteTask(task.id);
    } catch (e) {
      console.warn('[AutoPlan] Could not delete completed split:', e);
    }
  }

  if (!silent) {
    PluginAPI.showSnack({
      msg: `Merged ${mergeData.mergedCount} splits into "${mergeData.title}"`,
      type: 'SUCCESS',
    });
  }

  return {
    mergedTaskId: mergedTask.id,
    mergedCount: mergeData.mergedCount,
    totalTimeEstimate: mergeData.totalTimeEstimate,
  };
};

/**
 * Find all split task groups (async version)
 */
TaskMerger.findAllSplitGroupsAsync = async function() {
  const tasks = await PluginAPI.getTasks();
  return this.findAllSplitGroups(tasks);
};

// ============================================================================
// MAIN PLUGIN LOGIC
// ============================================================================

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Load configuration from persistent storage
 */
async function loadConfig() {
  try {
    const data = await PluginAPI.loadSyncedData();
    if (data) {
      const parsed = JSON.parse(data);
      currentConfig = { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (e) {
    console.log('[AutoPlan] No saved config found, using defaults');
  }
  return currentConfig;
}

/**
 * Save configuration to persistent storage
 */
async function saveConfig(config) {
  currentConfig = { ...currentConfig, ...config };
  await PluginAPI.persistDataSynced(JSON.stringify(currentConfig));
}

/**
 * Run the autoplanning algorithm
 */
async function runAutoplan(dryRun = false) {
  console.log('[AutoPlan] Starting autoplanning...');

  try {
    // Step 1: Clear previous planning (merge splits + clear scheduled times)
    // Skip this step for dry run since we don't want to modify tasks
    if (!dryRun) {
      console.log('[AutoPlan] Clearing previous planning...');
      const clearResult = await clearPlanning(true); // silent mode - don't show snack
      console.log(`[AutoPlan] Merged ${clearResult.merged} split groups, cleared ${clearResult.cleared} tasks`);
    }

    // Load config
    const config = await loadConfig();

    // Get all tasks, tags, and projects (re-fetch after clearing)
    const allTasks = await PluginAPI.getTasks();
    const allTags = await PluginAPI.getAllTags();
    const allProjects = await PluginAPI.getAllProjects();

    console.log(`[AutoPlan] Processing ${allTasks.length} tasks`);

    // Separate fixed tasks (tasks with do-not-reschedule tag)
    let fixedTasks = [];
    let schedulableTasks = allTasks;
    
    if (config.doNotRescheduleTagId) {
      fixedTasks = allTasks.filter(t => 
        !t.isDone && 
        t.tagIds && 
        t.tagIds.includes(config.doNotRescheduleTagId)
      );
      schedulableTasks = allTasks.filter(t => 
        !t.tagIds || 
        !t.tagIds.includes(config.doNotRescheduleTagId)
      );
      console.log(`[AutoPlan] ${fixedTasks.length} fixed tasks (will not be rescheduled)`);
    }

    // Filter to only incomplete tasks with time estimates
    const eligibleTasks = schedulableTasks.filter(t => 
      !t.isDone && 
      t.timeEstimate && 
      t.timeEstimate > 0
    );

    console.log(`[AutoPlan] ${eligibleTasks.length} eligible tasks with estimates`);

    // Split tasks into blocks
    const { splits, skippedParents } = TaskSplitter.processAllTasks(
      eligibleTasks,
      config.blockSizeMinutes,
      config
    );

    console.log(`[AutoPlan] Created ${splits.length} time blocks`);
    console.log(`[AutoPlan] Skipped ${skippedParents.length} parent tasks`);

    // Run scheduling algorithm
    const { schedule, deadlineMisses } = AutoPlanner.schedule(splits, config, allTags, allProjects, new Date(), fixedTasks);

    console.log(`[AutoPlan] Generated schedule with ${schedule.length} entries`);
    if (deadlineMisses.length > 0) {
      console.log(`[AutoPlan] Warning: ${deadlineMisses.length} tasks may miss their deadlines`);
    }

    // Show preview
    let message = `AutoPlan: ${schedule.length} blocks scheduled`;
    if (schedule.length > 0) {
      const firstDate = schedule[0].startTime.toLocaleDateString();
      const lastDate = schedule[schedule.length - 1].startTime.toLocaleDateString();
      message += ` (${firstDate} - ${lastDate})`;
    }

    if (dryRun) {
      PluginAPI.showSnack({
        msg: `[Dry Run] ${message}`,
        type: 'INFO',
      });
      return { schedule, applied: false };
    }

    // Apply the schedule
    const result = await AutoPlanner.applySchedule(schedule, eligibleTasks);

    // Check for errors and adjust message accordingly
    if (result.errors && result.errors.length > 0) {
      PluginAPI.showSnack({
        msg: `${message} (${result.errors.length} errors)`,
        type: 'WARNING',
      });
    } else {
      PluginAPI.showSnack({
        msg: message,
        type: 'SUCCESS',
      });
    }

    return { schedule, applied: true, result };

  } catch (error) {
    console.error('[AutoPlan] Error:', error);
    PluginAPI.showSnack({
      msg: `AutoPlan error: ${error.message}`,
      type: 'ERROR',
    });
    throw error;
  }
}

/**
 * Preview the schedule without applying
 */
async function previewSchedule() {
  return runAutoplan(true);
}

/**
 * Clear planning (dueWithTime, dueDay, hasPlannedTime) from all tasks that:
 * - Don't have the "Do Not Reschedule" tag
 * - Have a time estimation
 * - Are not completed
 * 
 * Also merges all split tasks back into their original tasks first.
 * 
 * @param {boolean} silent - If true, don't show snack notifications (used when called internally)
 */
async function clearPlanning(silent = false) {
  console.log('[AutoPlan] Clearing planning from tasks...');

  try {
    const config = await loadConfig();
    
    // Step 1: Merge all split tasks first
    console.log('[AutoPlan] Step 1: Merging split tasks...');
    const splitGroups = await TaskMerger.findAllSplitGroupsAsync();
    let mergedCount = 0;
    
    for (const group of splitGroups) {
      // Get the first task ID from the group to trigger merge
      const firstTaskId = group.splits[0];
      try {
        // Pass silent=true to suppress individual merge notifications
        const result = await TaskMerger.mergeSplits(firstTaskId, true);
        if (result) {
          mergedCount++;
          console.log(`[AutoPlan] Merged group: ${group.originalTitle}`);
        }
      } catch (e) {
        console.warn(`[AutoPlan] Failed to merge group ${group.originalTitle}:`, e);
      }
    }
    
    console.log(`[AutoPlan] Merged ${mergedCount} split task groups`);

    // Step 2: Clear planning from all eligible tasks
    console.log('[AutoPlan] Step 2: Clearing planning...');
    const allTasks = await PluginAPI.getTasks();

    // Filter tasks that should have their planning cleared:
    // - Not done
    // - Has time estimate
    // - Does NOT have the "do not reschedule" tag
    const tasksToClear = allTasks.filter(task => {
      // Skip completed tasks
      if (task.isDone) return false;
      
      // Skip tasks without time estimate
      if (!task.timeEstimate || task.timeEstimate <= 0) return false;
      
      // Skip tasks with "do not reschedule" tag
      if (config.doNotRescheduleTagId && task.tagIds && task.tagIds.includes(config.doNotRescheduleTagId)) {
        return false;
      }
      
      // Only include tasks that have some planning set
      if (!task.dueWithTime && !task.dueDay) return false;
      
      return true;
    });

    console.log(`[AutoPlan] Found ${tasksToClear.length} tasks to clear planning from`);

    // Clear planning from each task
    let clearedCount = 0;
    for (const task of tasksToClear) {
      try {
        await PluginAPI.updateTask(task.id, {
          dueWithTime: undefined,
          dueDay: undefined,
          hasPlannedTime: undefined,
        });
        clearedCount++;
      } catch (e) {
        console.warn(`[AutoPlan] Failed to clear planning for task ${task.id}:`, e);
      }
    }

    // Build result message
    let message = '';
    if (mergedCount > 0 && clearedCount > 0) {
      message = `Merged ${mergedCount} split groups, cleared planning from ${clearedCount} tasks`;
    } else if (mergedCount > 0) {
      message = `Merged ${mergedCount} split groups`;
    } else if (clearedCount > 0) {
      message = `Cleared planning from ${clearedCount} tasks`;
    } else {
      message = 'No tasks to clear planning from';
    }

    if (!silent) {
      PluginAPI.showSnack({
        msg: message,
        type: mergedCount > 0 || clearedCount > 0 ? 'SUCCESS' : 'INFO',
      });
    }

    return { merged: mergedCount, cleared: clearedCount };

  } catch (error) {
    console.error('[AutoPlan] Error clearing planning:', error);
    PluginAPI.showSnack({
      msg: `Error clearing planning: ${error.message}`,
      type: 'ERROR',
    });
    throw error;
  }
}

// ============================================================================
// PLUGIN INITIALIZATION
// ============================================================================

// Register side panel button
PluginAPI.registerSidePanelButton({
  label: 'AutoPlan',
  icon: 'auto_fix_high',
  onClick: () => {
    // Required handler - side panel content is shown via sidePanel:true in manifest
  },
});

// Register keyboard shortcut - opens the panel
PluginAPI.registerShortcut({
  keys: 'ctrl+shift+a',
  label: 'Open AutoPlan',
  action: () => {
    PluginAPI.showIndexHtmlAsView();
  },
});

// Expose functions for iframe communication
window.AutoPlanAPI = {
  runAutoplan,
  previewSchedule,
  clearPlanning,
  loadConfig,
  saveConfig,
  getDefaultConfig: () => ({ ...DEFAULT_CONFIG }),
  // Merge functions
  findRelatedSplits: (taskId) => TaskMerger.findRelatedSplitsAsync(taskId),
  mergeSplits: (taskId) => TaskMerger.mergeSplits(taskId),
  findAllSplitGroups: () => TaskMerger.findAllSplitGroupsAsync(),
};

console.log('[AutoPlan] Plugin loaded successfully');
PluginAPI.showSnack({
  msg: 'AutoPlan plugin loaded. Press Ctrl+Shift+A to open.',
  type: 'INFO',
});
