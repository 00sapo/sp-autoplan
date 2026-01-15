/**
 * AutoPlan - Automatic Task Scheduler for Super Productivity
 * 
 * This plugin implements an urgency-based scheduling algorithm similar to taskcheck.
 * It calculates task priority based on:
 * 1. Base priority (order in list)
 * 2. Tag-based priority boosts
 * 3. Estimated duration factor
 * 4. Task age/oldness factor
 * 
 * Then it splits tasks into time blocks and schedules them by urgency.
 * 
 * AUTO-GENERATED FILE - Do not edit directly!
 * Edit src/core.js and src/plugin-template.js instead, then run: npm run build
 */

/**
 * AutoPlan - Core Library (testable, no PluginAPI dependencies)
 */

// ============================================================================
// CONFIGURATION DEFAULTS
// ============================================================================

const DEFAULT_CONFIG = {
  blockSizeMinutes: 120, // 2 hours default block size
  tagPriorities: {}, // { tagName: priorityBoost }
  durationFormula: 'linear', // 'linear', 'inverse', 'log', 'none'
  durationWeight: 1.0,
  oldnessFormula: 'linear', // 'linear', 'log', 'exponential', 'none'
  oldnessWeight: 1.0,
  maxDaysAhead: 30,
  autoRunOnStart: false,
  splitPrefix: '', // Prefix for split task names (empty = use original name)
  splitSuffix: true, // Add roman numerals as suffix
  workdayStartHour: 9,
  workdayHours: 8,
  skipDays: [0, 6], // Days of week to skip (0 = Sunday, 6 = Saturday)
  doNotRescheduleTagId: null, // Tag ID for tasks that should not be rescheduled
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert number to Roman numerals
 */
function toRoman(num) {
  if (num <= 0) return 'I'; // Handle edge case - minimum is I
  if (num > 3999) return String(num); // Roman numerals only go up to 3999
  
  const romanNumerals = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
    ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
    ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]
  ];
  let result = '';
  for (const [letter, value] of romanNumerals) {
    while (num >= value) {
      result += letter;
      num -= value;
    }
  }
  return result;
}

/**
 * Calculate hours between two dates
 */
function hoursBetween(date1, date2) {
  return Math.abs(date2 - date1) / (1000 * 60 * 60);
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1, date2) {
  return Math.abs(date2 - date1) / (1000 * 60 * 60 * 24);
}

/**
 * Get task age in days
 */
function getTaskAgeInDays(task, now = new Date()) {
  if (!task.created) return 0;
  const created = new Date(task.created);
  return daysBetween(created, now);
}

/**
 * Get estimated duration in hours from task
 */
function getEstimatedHours(task) {
  if (task.timeEstimate) {
    return task.timeEstimate / (1000 * 60 * 60);
  }
  return 0;
}

/**
 * Get remaining time in hours
 */
function getRemainingHours(task) {
  const estimated = getEstimatedHours(task);
  const spent = task.timeSpent ? task.timeSpent / (1000 * 60 * 60) : 0;
  return Math.max(0, estimated - spent);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// PRIORITY CALCULATION MODULE
// ============================================================================

const PriorityCalculator = {
  /**
   * Calculate base priority from parent task order (N+1-r where N is total parent tasks, r is rank)
   * Subtasks inherit their parent's base priority.
   * 
   * @param {Object} task - The task to calculate priority for
   * @param {Array} parentTasks - Array of parent tasks (top-level tasks or tasks with subtasks) in order
   * @param {Map} parentIdMap - Map of task ID to parent task (for looking up a subtask's parent)
   */
  calculateBasePriority(task, parentTasks, parentIdMap = null) {
    // If this is a subtask and we have a parent map, find the parent's priority
    if (task.parentId && parentIdMap) {
      const parent = parentIdMap.get(task.parentId);
      if (parent) {
        // Recursively get parent's priority (handles nested subtasks)
        return this.calculateBasePriority(parent, parentTasks, parentIdMap);
      }
    }
    
    // For parent tasks (or if no parent found), calculate from position in parentTasks
    const totalTasks = parentTasks.length;
    const rank = parentTasks.findIndex(t => t.id === task.id) + 1;
    if (rank === 0) return 0; // Task not found in parent list
    return totalTasks + 1 - rank;
  },

  /**
   * Calculate tag-based priority boost
   */
  calculateTagPriority(task, tagPriorities, allTags) {
    if (!task.tagIds || task.tagIds.length === 0) return 0;
    if (!tagPriorities || typeof tagPriorities !== 'object') return 0;
    
    let boost = 0;
    for (const tagId of task.tagIds) {
      const tag = allTags.find(t => t.id === tagId);
      if (tag && tagPriorities[tag.name] !== undefined) {
        boost += Number(tagPriorities[tag.name]) || 0;
      }
    }
    return boost;
  },

  /**
   * Calculate duration-based priority factor
   */
  calculateDurationPriority(task, formula, weight) {
    const hours = getRemainingHours(task);
    if (hours <= 0 || formula === 'none') return 0;
    if (weight <= 0) return 0;

    let factor;
    switch (formula) {
      case 'inverse':
        // Shorter tasks get higher priority
        factor = 1 / (hours + 1);
        break;
      case 'log':
        // Logarithmic scaling
        factor = Math.log(hours + 1);
        break;
      case 'linear':
      default:
        // Linear with hours
        factor = hours;
        break;
    }
    return factor * weight;
  },

  /**
   * Calculate oldness-based priority factor
   * Includes capping to prevent overflow with exponential formula
   */
  calculateOldnessPriority(task, formula, weight, now = new Date()) {
    const days = getTaskAgeInDays(task, now);
    if (days <= 0 || formula === 'none') return 0;
    if (weight <= 0) return 0;

    let factor;
    switch (formula) {
      case 'exponential':
        // Cap at 100 days to prevent overflow (1.1^100 ≈ 13780)
        const cappedDays = Math.min(days, 100);
        factor = Math.pow(1.1, cappedDays);
        break;
      case 'log':
        factor = Math.log(days + 1);
        break;
      case 'linear':
      default:
        factor = days;
        break;
    }
    return factor * weight;
  },

  /**
   * Calculate total urgency/priority for a task
   * 
   * @param {Object} task - The task to calculate urgency for
   * @param {Array} parentTasks - Array of parent tasks in order (for base priority)
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Date} now - Current time for calculations
   * @param {Map} parentIdMap - Optional map of task ID to parent task
   */
  calculateUrgency(task, parentTasks, config, allTags, now = new Date(), parentIdMap = null) {
    const basePriority = this.calculateBasePriority(task, parentTasks, parentIdMap);
    const tagPriority = this.calculateTagPriority(task, config.tagPriorities || {}, allTags);
    const durationPriority = this.calculateDurationPriority(
      task, config.durationFormula || 'linear', config.durationWeight ?? 1.0
    );
    const oldnessPriority = this.calculateOldnessPriority(
      task, config.oldnessFormula || 'linear', config.oldnessWeight ?? 1.0, now
    );

    return {
      total: basePriority + tagPriority + durationPriority + oldnessPriority,
      components: {
        base: basePriority,
        tag: tagPriority,
        duration: durationPriority,
        oldness: oldnessPriority
      }
    };
  }
};

// ============================================================================
// TASK SPLITTING MODULE
// ============================================================================

const TaskSplitter = {
  /**
   * Split a task into time blocks
   * Returns an array of split task objects
   */
  splitTask(task, blockSizeMinutes, config) {
    // Validate inputs
    if (!blockSizeMinutes || blockSizeMinutes <= 0) {
      blockSizeMinutes = DEFAULT_CONFIG.blockSizeMinutes;
    }

    const remainingHours = getRemainingHours(task);
    if (remainingHours <= 0) return [];

    const blockSizeHours = blockSizeMinutes / 60;
    const numBlocks = Math.ceil(remainingHours / blockSizeHours);
    const splits = [];

    for (let i = 0; i < numBlocks; i++) {
      const isLastBlock = i === numBlocks - 1;
      const blockHours = isLastBlock 
        ? remainingHours - (i * blockSizeHours) 
        : blockSizeHours;

      let splitName = task.title;
      if (config.splitPrefix) {
        splitName = config.splitPrefix + splitName;
      }
      if (config.splitSuffix !== false) {
        splitName = `${splitName} <${toRoman(i + 1)}>`;
      }

      splits.push({
        originalTaskId: task.id,
        originalTask: task,
        splitIndex: i,
        totalSplits: numBlocks,
        title: splitName,
        estimatedHours: blockHours,
        estimatedMs: blockHours * 60 * 60 * 1000,
        tagIds: task.tagIds || [],
        projectId: task.projectId,
        parentId: task.parentId,
        // Link to other splits
        prevSplitIndex: i > 0 ? i - 1 : null,
        nextSplitIndex: i < numBlocks - 1 ? i + 1 : null,
      });
    }

    return splits;
  },

  /**
   * Check if a task has already been processed by AutoPlan
   */
  isAlreadyProcessed(task) {
    if (!task.notes) return false;
    return task.notes.includes('[AutoPlan]');
  },

  /**
   * Process all tasks and split them into blocks
   * Skips parent tasks that have subtasks
   */
  processAllTasks(tasks, blockSizeMinutes, config) {
    // Find parent task IDs (tasks that have subtasks)
    const parentIds = new Set();
    for (const task of tasks) {
      if (task.parentId) {
        parentIds.add(task.parentId);
      }
    }

    const allSplits = [];
    const skippedParents = [];
    const alreadyProcessed = [];

    for (const task of tasks) {
      // Skip if this task is a parent with subtasks
      if (parentIds.has(task.id)) {
        skippedParents.push(task);
        continue;
      }

      // Skip completed tasks
      if (task.isDone) continue;

      // Skip already processed tasks
      if (this.isAlreadyProcessed(task)) {
        alreadyProcessed.push(task);
        continue;
      }

      const splits = this.splitTask(task, blockSizeMinutes, config);
      allSplits.push(...splits);
    }

    return { splits: allSplits, skippedParents, alreadyProcessed };
  }
};

// ============================================================================
// AUTOPLANNING ALGORITHM
// ============================================================================

const AutoPlanner = {
  /**
   * Check if a day should be skipped based on config
   */
  shouldSkipDay(date, skipDays) {
    if (!skipDays || !Array.isArray(skipDays) || skipDays.length === 0) {
      return false;
    }
    return skipDays.includes(date.getDay());
  },

  /**
   * Advance to the next working day (skipping configured days)
   */
  advanceToNextWorkday(date, skipDays, workdayStartHour) {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 1);
    newDate.setHours(workdayStartHour, 0, 0, 0);
    
    // Keep advancing while we're on a skip day (max 7 iterations to prevent infinite loop)
    let iterations = 0;
    while (this.shouldSkipDay(newDate, skipDays) && iterations < 7) {
      newDate.setDate(newDate.getDate() + 1);
      iterations++;
    }
    
    return newDate;
  },

  /**
   * Get the current time slot start based on current time
   */
  getCurrentDayMinutes(now, workdayStartHour = 9) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // If before work start, return 0
    if (currentHour < workdayStartHour) {
      return 0;
    }
    
    // Calculate minutes since work day started
    return (currentHour - workdayStartHour) * 60 + currentMinute;
  },

  /**
   * Get the date key (YYYY-MM-DD) for a given date
   */
  getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Calculate fixed task minutes per day from a list of fixed tasks
   * Fixed tasks are tasks that have the "do not reschedule" tag and have a scheduled time
   */
  calculateFixedMinutesPerDay(fixedTasks) {
    const fixedMinutesPerDay = {};
    
    for (const task of fixedTasks) {
      // Task needs to have a scheduled time (dueWithTime) and a time estimate
      if (!task.dueWithTime || !task.timeEstimate || task.timeEstimate <= 0) {
        continue;
      }
      
      const scheduledDate = new Date(task.dueWithTime);
      const dateKey = this.getDateKey(scheduledDate);
      
      // timeEstimate is in milliseconds, convert to minutes
      const taskMinutes = Math.ceil(task.timeEstimate / 60000);
      
      if (!fixedMinutesPerDay[dateKey]) {
        fixedMinutesPerDay[dateKey] = 0;
      }
      fixedMinutesPerDay[dateKey] += taskMinutes;
    }
    
    return fixedMinutesPerDay;
  },

  /**
   * Main scheduling algorithm
   * Assigns time blocks to the most urgent tasks iteratively
   * @param {Array} splits - Task splits to schedule
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Date} startTime - When to start scheduling from
   * @param {Array} fixedTasks - Tasks that should not be rescheduled (optional)
   * @param {Array} allTasks - All tasks (for building parent hierarchy) (optional)
   */
  schedule(splits, config, allTags, startTime = new Date(), fixedTasks = [], allTasks = []) {
    if (splits.length === 0) return [];

    const schedule = [];
    const remainingSplits = [...splits];
    let simulatedTime = new Date(startTime);
    
    const workdayStartHour = config.workdayStartHour ?? 9;
    const baseMaxMinutesPerDay = (config.workdayHours ?? 8) * 60;
    const maxDaysAhead = config.maxDaysAhead ?? 30;
    const skipDays = config.skipDays ?? [];
    
    // Calculate fixed task minutes per day
    const fixedMinutesPerDay = this.calculateFixedMinutesPerDay(fixedTasks);
    
    // Build parent task hierarchy
    // Parent tasks are: tasks that have subtasks OR top-level tasks (no parentId)
    const taskMap = new Map();
    const parentIds = new Set();
    for (const task of allTasks) {
      taskMap.set(task.id, task);
      if (task.parentId) {
        parentIds.add(task.parentId);
      }
    }
    
    // Get parent tasks in order (tasks that are parents OR top-level non-done tasks)
    // A "parent task" for priority purposes is either:
    // 1. A task that has subtasks (is in parentIds)
    // 2. A top-level task (no parentId) that doesn't have subtasks
    const parentTasks = allTasks.filter(task => {
      // Skip done tasks
      if (task.isDone) return false;
      // Include if it's a parent (has subtasks)
      if (parentIds.has(task.id)) return true;
      // Include if it's top-level (no parent)
      if (!task.parentId) return true;
      return false;
    });
    
    // Helper to get available minutes for a specific day
    const getAvailableMinutesForDay = (date) => {
      const dateKey = this.getDateKey(date);
      const fixedMinutes = fixedMinutesPerDay[dateKey] || 0;
      return Math.max(0, baseMaxMinutesPerDay - fixedMinutes);
    };
    
    // Start from current time if during work hours
    let currentDayMinutes = this.getCurrentDayMinutes(simulatedTime, workdayStartHour);
    let maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
    
    // If we're past work hours or current day minutes exceeds max, move to next workday
    if (currentDayMinutes >= maxMinutesForCurrentDay) {
      simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
      currentDayMinutes = 0;
      maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
    } else if (this.shouldSkipDay(simulatedTime, skipDays)) {
      // If starting on a skip day, find the next valid workday
      // We use a temp date set to previous day so advanceToNextWorkday lands on correct day
      const tempDate = new Date(simulatedTime);
      tempDate.setDate(tempDate.getDate() - 1);
      simulatedTime = this.advanceToNextWorkday(tempDate, skipDays, workdayStartHour);
      currentDayMinutes = 0;
      maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
    }
    
    const startDate = new Date(simulatedTime);
    let daysScheduled = 0;

    while (remainingSplits.length > 0 && daysScheduled < maxDaysAhead) {
      // Calculate urgency for all remaining splits
      // Base priority comes from parent tasks order, subtasks inherit from parents
      const splitsWithUrgency = remainingSplits.map((split, index) => {
        // Calculate total remaining time for all unscheduled splits of the same original task
        const remainingSplitsForTask = remainingSplits.filter(
          s => s.originalTaskId === split.originalTaskId
        );
        const totalRemainingMs = remainingSplitsForTask.reduce(
          (sum, s) => sum + s.estimatedMs, 0
        );

        // Create a pseudo-task for urgency calculation
        // Use the total remaining time for the original task, not just this split's time
        const pseudoTask = {
          ...split.originalTask,
          id: split.originalTaskId, // Use original task ID for base priority lookup
          timeEstimate: totalRemainingMs,
          timeSpent: 0,
        };

        const urgency = PriorityCalculator.calculateUrgency(
          pseudoTask, 
          parentTasks, // Use parent tasks for base priority calculation
          config,
          allTags,
          simulatedTime,
          taskMap // Pass task map for parent lookup
        );

        return {
          split,
          urgency: urgency.total,
          urgencyComponents: urgency.components,
          index
        };
      });

      // Sort by urgency (highest first)
      splitsWithUrgency.sort((a, b) => b.urgency - a.urgency);

      // Get the most urgent split
      const mostUrgent = splitsWithUrgency[0];
      const blockMinutes = mostUrgent.split.estimatedHours * 60;

      // Check if we need to move to next day
      if (currentDayMinutes + blockMinutes > maxMinutesForCurrentDay) {
        simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
        currentDayMinutes = 0;
        maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
        daysScheduled = daysBetween(startDate, simulatedTime);
        
        if (daysScheduled >= maxDaysAhead) {
          break; // Stop scheduling if we've exceeded max days
        }
        
        // If the new day has no available time (entirely filled by fixed tasks), skip it
        // Keep advancing until we find a day with available time or exceed maxDaysAhead
        while (maxMinutesForCurrentDay < blockMinutes && daysScheduled < maxDaysAhead) {
          simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
          maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
          daysScheduled = daysBetween(startDate, simulatedTime);
        }
        
        if (daysScheduled >= maxDaysAhead) {
          break;
        }
      }

      // Assign the block
      const blockStartTime = new Date(simulatedTime);
      // Calculate hours and minutes from currentDayMinutes offset from workday start
      const totalMinutesFromMidnight = workdayStartHour * 60 + currentDayMinutes;
      blockStartTime.setHours(Math.floor(totalMinutesFromMidnight / 60));
      blockStartTime.setMinutes(totalMinutesFromMidnight % 60);
      blockStartTime.setSeconds(0);
      blockStartTime.setMilliseconds(0);
      
      const endTime = new Date(blockStartTime);
      endTime.setMinutes(endTime.getMinutes() + blockMinutes);

      schedule.push({
        split: mostUrgent.split,
        startTime: blockStartTime,
        endTime,
        urgency: mostUrgent.urgency,
        urgencyComponents: mostUrgent.urgencyComponents,
      });

      // Update simulation state
      currentDayMinutes += blockMinutes;

      // Remove the scheduled split
      const removeIndex = remainingSplits.findIndex(
        s => s.originalTaskId === mostUrgent.split.originalTaskId && 
             s.splitIndex === mostUrgent.split.splitIndex
      );
      remainingSplits.splice(removeIndex, 1);
    }

    return schedule;
  },
};

// ============================================================================
// TASK MERGE MODULE
// ============================================================================

const TaskMerger = {
  /**
   * Parse the notes field to extract original task ID and split info
   * Uses a more robust parsing approach
   */
  parseSplitInfo(task) {
    if (!task.notes) return null;
    
    // Look for the AutoPlan split marker with more flexible pattern
    // Handle potential special characters in title
    const splitMatch = task.notes.match(/Split (\d+)\/(\d+) of "((?:[^"\\]|\\.)*)"/);
    const idMatch = task.notes.match(/Original Task ID: ([^\n\s]+)/);
    
    if (splitMatch && idMatch) {
      return {
        splitIndex: parseInt(splitMatch[1]) - 1,
        totalSplits: parseInt(splitMatch[2]),
        originalTitle: splitMatch[3].replace(/\\"/g, '"'), // Unescape quotes
        originalTaskId: idMatch[1].trim(),
      };
    }
    return null;
  },

  /**
   * Escape title for safe inclusion in notes
   */
  escapeTitle(title) {
    return title.replace(/"/g, '\\"');
  },

  /**
   * Generate the notes content for a split task
   */
  generateSplitNotes(splitIndex, totalSplits, originalTitle, originalTaskId) {
    const escapedTitle = this.escapeTitle(originalTitle);
    return `Split ${splitIndex + 1}/${totalSplits} of "${escapedTitle}"\n\nOriginal Task ID: ${originalTaskId}`;
  },

  /**
   * Find all split tasks that belong to the same original task
   */
  findRelatedSplits(tasks, taskId) {
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) return { splits: [], originalTaskId: null };

    const splitInfo = this.parseSplitInfo(task);
    if (!splitInfo) return { splits: [], originalTaskId: null };

    // Find all tasks with the same original task ID
    const relatedSplits = tasks.filter(t => {
      const info = this.parseSplitInfo(t);
      return info && info.originalTaskId === splitInfo.originalTaskId;
    });

    // Sort by split index
    relatedSplits.sort((a, b) => {
      const infoA = this.parseSplitInfo(a);
      const infoB = this.parseSplitInfo(b);
      return (infoA?.splitIndex || 0) - (infoB?.splitIndex || 0);
    });

    return {
      splits: relatedSplits,
      originalTaskId: splitInfo.originalTaskId,
      originalTitle: splitInfo.originalTitle,
    };
  },

  /**
   * Calculate merged task data from splits
   */
  calculateMergeData(incompleteSplits, originalTitle) {
    let totalTimeEstimate = 0;
    let totalTimeSpent = 0;
    
    for (const split of incompleteSplits) {
      totalTimeEstimate += split.timeEstimate || 0;
      totalTimeSpent += split.timeSpent || 0;
    }

    // Clean title by removing Roman numeral suffix in <> brackets
    // Pattern: " <I>", " <II>", " <XIV>", etc.
    const cleanTitle = originalTitle || incompleteSplits[0]?.title?.replace(/ <[IVXLCDM]+>$/, '') || 'Merged Task';

    return {
      title: cleanTitle,
      totalTimeEstimate,
      totalTimeSpent,
      mergedCount: incompleteSplits.length,
    };
  },

  /**
   * Find all split task groups in the task list
   */
  findAllSplitGroups(tasks) {
    const groups = new Map();

    for (const task of tasks) {
      const splitInfo = this.parseSplitInfo(task);
      if (splitInfo) {
        if (!groups.has(splitInfo.originalTaskId)) {
          groups.set(splitInfo.originalTaskId, {
            originalTaskId: splitInfo.originalTaskId,
            originalTitle: splitInfo.originalTitle,
            splits: [],
          });
        }
        groups.get(splitInfo.originalTaskId).splits.push({
          task,
          splitInfo,
        });
      }
    }

    // Sort splits within each group
    for (const group of groups.values()) {
      group.splits.sort((a, b) => a.splitInfo.splitIndex - b.splitInfo.splitIndex);
    }

    return Array.from(groups.values());
  },
};


// ============================================================================
// PLUGIN-SPECIFIC EXTENSIONS (uses PluginAPI)
// These methods extend the core library with Super Productivity integration
// ============================================================================

/**
 * Get scheduling fields for a task based on its scheduled time.
 * Uses dueWithTime (timestamp in milliseconds) for all tasks.
 * This ensures tasks scheduled for the future appear in Planner, not Today.
 */
function getSchedulingFields(startTime) {
  return {
    dueWithTime: startTime.getTime(),
    dueDay: null, // Clear dueDay to avoid conflicts
  };
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
    const allTasks = await PluginAPI.getTasks();
    const allTags = await PluginAPI.getAllTags();

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
    // Pass allTasks for building parent hierarchy for base priority calculation
    const schedule = AutoPlanner.schedule(splits, config, allTags, new Date(), fixedTasks, allTasks);

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

