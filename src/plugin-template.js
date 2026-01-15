// ============================================================================
// PLUGIN-SPECIFIC EXTENSIONS (uses PluginAPI)
// These methods extend the core library with Super Productivity integration
// ============================================================================

/**
 * Format a Date as "YYYY-MM-DD" string for Super Productivity's dueDay field
 */
function formatDateAsDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date is today
 */
function isToday(date) {
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
         date.getMonth() === today.getMonth() &&
         date.getDate() === today.getDate();
}

/**
 * Get scheduling fields for a task based on its scheduled time.
 * - For today: use dueWithTime (shows in Today view with specific time)
 * - For future days: use dueDay (shows in Planner view without cluttering Today)
 */
function getSchedulingFields(startTime) {
  if (isToday(startTime)) {
    // For today, use dueWithTime so it appears in Today with scheduled time
    return {
      dueWithTime: startTime.getTime(),
      dueDay: null, // Clear dueDay when setting dueWithTime
    };
  } else {
    // For future days, use dueDay so it appears in Planner, not Today
    return {
      dueDay: formatDateAsDay(startTime),
      dueWithTime: null, // Clear dueWithTime when setting dueDay
    };
  }
}

/**
 * Apply the schedule by creating/updating tasks in Super Productivity
 * This extends AutoPlanner with PluginAPI integration
 */
AutoPlanner.applySchedule = async function(schedule, originalTasks) {
  const createdTasks = [];
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
      // Create split tasks
      const splitTaskIds = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Create new task for this split
        const newTaskId = await PluginAPI.addTask({
          title: item.split.title,
          timeEstimate: item.split.estimatedMs,
          tagIds: item.split.tagIds,
          projectId: item.split.projectId,
          notes: TaskMerger.generateSplitNotes(
            item.split.splitIndex,
            item.split.totalSplits,
            originalTask.title,
            originalId
          ),
        });

        // Set the scheduled time via updateTask using appropriate field
        const schedulingFields = getSchedulingFields(item.startTime);
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

      // Delete the original task since it's now been split
      try {
        await PluginAPI.deleteTask(originalId);
      } catch (e) {
        console.warn('[AutoPlan] Could not delete original task:', e);
        // Fallback: mark as done and add note
        await PluginAPI.updateTask(originalId, {
          isDone: true,
          notes: `${originalTask.notes || ''}\n\n[AutoPlan] This task was split into ${items.length} blocks.`,
        });
      }
    }
  }

  return createdTasks;
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
 */
TaskMerger.mergeSplits = async function(taskId) {
  const tasks = await PluginAPI.getTasks();
  const { splits, originalTaskId, originalTitle } = this.findRelatedSplits(tasks, taskId);
  
  if (splits.length === 0) {
    PluginAPI.showSnack({
      msg: 'This task is not a split task',
      type: 'WARNING',
    });
    return null;
  }

  if (splits.length === 1) {
    PluginAPI.showSnack({
      msg: 'Only one split remaining, nothing to merge',
      type: 'INFO',
    });
    return null;
  }

  // Calculate total remaining time from incomplete splits
  const incompleteSplits = splits.filter(s => !s.isDone);
  if (incompleteSplits.length === 0) {
    PluginAPI.showSnack({
      msg: 'All splits are already completed',
      type: 'INFO',
    });
    return null;
  }

  // Calculate merge data
  const mergeData = this.calculateMergeData(incompleteSplits, originalTitle);

  // Use the first incomplete split as the merged task
  const mergedTask = incompleteSplits[0];
  const tasksToDelete = incompleteSplits.slice(1);

  // Update the merged task
  await PluginAPI.updateTask(mergedTask.id, {
    title: mergeData.title,
    timeEstimate: mergeData.totalTimeEstimate,
    timeSpent: mergeData.totalTimeSpent,
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

  PluginAPI.showSnack({
    msg: `Merged ${mergeData.mergedCount} splits into "${mergeData.title}"`,
    type: 'SUCCESS',
  });

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
    // Load config
    const config = await loadConfig();

    // Get all tasks and tags
    const tasks = await PluginAPI.getTasks();
    const allTags = await PluginAPI.getAllTags();

    console.log(`[AutoPlan] Processing ${tasks.length} tasks`);

    // Filter to only incomplete tasks with time estimates
    const eligibleTasks = tasks.filter(t => 
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
    const schedule = AutoPlanner.schedule(splits, config, allTags);

    console.log(`[AutoPlan] Generated schedule with ${schedule.length} entries`);

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

    PluginAPI.showSnack({
      msg: message,
      type: 'SUCCESS',
    });

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
