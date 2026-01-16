/**
 * AutoPlan - Core Library (testable, no PluginAPI dependencies)
 */

// ============================================================================
// CONFIGURATION DEFAULTS
// ============================================================================

export const DEFAULT_CONFIG = {
  blockSizeMinutes: 120, // 2 hours default block size
  tagPriorities: {}, // { tagName: priorityBoost }
  projectPriorities: {}, // { projectName: priorityBoost }
  durationFormula: 'linear', // 'linear', 'inverse', 'log', 'none'
  durationWeight: 1.0,
  oldnessFormula: 'linear', // 'linear', 'log', 'exponential', 'none'
  oldnessWeight: 1.0,
  deadlineFormula: 'linear', // 'linear', 'aggressive', 'none' - how deadline urgency increases as due date approaches
  deadlineWeight: 12.0, // Weight for deadline urgency (similar to taskcheck's urgency.due.coefficient default)
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
export function toRoman(num) {
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
export function hoursBetween(date1, date2) {
  return Math.abs(date2 - date1) / (1000 * 60 * 60);
}

/**
 * Calculate days between two dates
 */
export function daysBetween(date1, date2) {
  return Math.abs(date2 - date1) / (1000 * 60 * 60 * 24);
}

/**
 * Get task age in days
 */
export function getTaskAgeInDays(task, now = new Date()) {
  if (!task.created) return 0;
  const created = new Date(task.created);
  return daysBetween(created, now);
}

/**
 * Get estimated duration in hours from task
 */
export function getEstimatedHours(task) {
  if (task.timeEstimate) {
    return task.timeEstimate / (1000 * 60 * 60);
  }
  return 0;
}

/**
 * Get remaining time in hours
 */
export function getRemainingHours(task) {
  const estimated = getEstimatedHours(task);
  const spent = task.timeSpent ? task.timeSpent / (1000 * 60 * 60) : 0;
  return Math.max(0, estimated - spent);
}

/**
 * Get the due date of a task
 * Supports both 'dueDate' and 'dueWithTime' fields from Super Productivity
 * @returns {Date|null} The due date or null if not set
 */
export function getTaskDueDate(task) {
  // Super Productivity uses dueWithTime for tasks with specific due times
  // and dueDate for all-day due dates (both as timestamps in milliseconds)
  if (task.dueWithTime) {
    return new Date(task.dueWithTime);
  }
  if (task.dueDate) {
    return new Date(task.dueDate);
  }
  return null;
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// PRIORITY CALCULATION MODULE
// ============================================================================

export const PriorityCalculator = {
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
   * Calculate project-based priority boost
   */
  calculateProjectPriority(task, projectPriorities, allProjects) {
    if (!task.projectId) return 0;
    if (!projectPriorities || typeof projectPriorities !== 'object') return 0;
    
    const project = allProjects.find(p => p.id === task.projectId);
    if (project && projectPriorities[project.title] !== undefined) {
      return Number(projectPriorities[project.title]) || 0;
    }
    return 0;
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
   * Calculate deadline-based priority factor
   * Tasks with approaching deadlines get higher priority
   * Uses a 21-day range similar to taskcheck's urgency.due algorithm
   * 
   * @param {Object} task - The task to calculate deadline urgency for
   * @param {string} formula - 'linear', 'aggressive', or 'none'
   * @param {number} weight - Weight for deadline urgency (default 12.0 like taskcheck)
   * @param {Date} now - Current time for calculations
   * @returns {number} - Priority boost based on deadline proximity
   */
  calculateDeadlinePriority(task, formula, weight, now = new Date()) {
    if (formula === 'none') return 0;
    if (weight <= 0) return 0;

    const dueDate = getTaskDueDate(task);
    if (!dueDate) return 0;

    // Calculate days until due (negative = overdue)
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysUntilDue = (dueDate - now) / msPerDay;

    let factor;
    switch (formula) {
      case 'aggressive':
        // More aggressive urgency curve for very close deadlines
        // Overdue (7+ days overdue) = 1.0 (maximum)
        // Just due = 0.9
        // 1 week away = 0.5
        // 2+ weeks away = 0.2 (minimum)
        if (daysUntilDue <= -7) {
          factor = 1.0;
        } else if (daysUntilDue <= 0) {
          // Overdue (0-7 days overdue): 0.9 to 1.0
          factor = 0.9 + (-daysUntilDue / 7) * 0.1;
        } else if (daysUntilDue <= 7) {
          // Within 1 week: 0.5 to 0.9
          factor = 0.9 - (daysUntilDue / 7) * 0.4;
        } else if (daysUntilDue <= 14) {
          // Within 2 weeks: 0.2 to 0.5
          factor = 0.5 - ((daysUntilDue - 7) / 7) * 0.3;
        } else {
          factor = 0.2;
        }
        break;
      case 'linear':
      default:
        // Linear urgency similar to taskcheck
        // Maps a 21-day range to 0.2 - 1.0
        // Overdue (7+ days) = 1.0
        // 14 days in future = 0.2
        if (daysUntilDue <= -7) {
          factor = 1.0;
        } else if (daysUntilDue >= 14) {
          factor = 0.2;
        } else {
          // Linear interpolation from -7 days (1.0) to +14 days (0.2)
          // Range of 21 days maps to range of 0.8
          factor = 1.0 - ((daysUntilDue + 7) / 21) * 0.8;
        }
        break;
    }

    return factor * weight;
  },

  /**
   * Calculate total urgency/priority for a task
   * 
   * @param {Object} task - The task to calculate urgency for
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} now - Current time for calculations
   */
  calculateUrgency(task, config, allTags, allProjects = [], now = new Date()) {
    const tagPriority = this.calculateTagPriority(task, config.tagPriorities || {}, allTags);
    const projectPriority = this.calculateProjectPriority(task, config.projectPriorities || {}, allProjects);
    const durationPriority = this.calculateDurationPriority(
      task, config.durationFormula || 'none', config.durationWeight ?? 1.0
    );
    const oldnessPriority = this.calculateOldnessPriority(
      task, config.oldnessFormula || 'none', config.oldnessWeight ?? 1.0, now
    );
    const deadlinePriority = this.calculateDeadlinePriority(
      task, config.deadlineFormula || 'none', config.deadlineWeight ?? 12.0, now
    );

    return {
      total: tagPriority + projectPriority + durationPriority + oldnessPriority + deadlinePriority,
      components: {
        tag: tagPriority,
        project: projectPriority,
        duration: durationPriority,
        oldness: oldnessPriority,
        deadline: deadlinePriority
      }
    };
  }
};

// ============================================================================
// TASK SPLITTING MODULE
// ============================================================================

export const TaskSplitter = {
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

export const AutoPlanner = {
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
   * @param {Array} allProjects - All available projects
   * @param {Date} startTime - When to start scheduling from
   * @param {Array} fixedTasks - Tasks that should not be rescheduled (optional)
   * @returns {Object} - { schedule: Array, deadlineMisses: Array } where schedule contains scheduled items
   *                     and deadlineMisses contains tasks that will miss their deadlines
   */
  schedule(splits, config, allTags, allProjects = [], startTime = new Date(), fixedTasks = []) {
    if (splits.length === 0) return { schedule: [], deadlineMisses: [] };

    const schedule = [];
    const remainingSplits = [...splits];
    let simulatedTime = new Date(startTime);
    
    const workdayStartHour = config.workdayStartHour ?? 9;
    const baseMaxMinutesPerDay = (config.workdayHours ?? 8) * 60;
    const maxDaysAhead = config.maxDaysAhead ?? 30;
    const skipDays = config.skipDays ?? [];
    
    // Calculate fixed task minutes per day
    const fixedMinutesPerDay = this.calculateFixedMinutesPerDay(fixedTasks);
    
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
          id: split.originalTaskId,
          timeEstimate: totalRemainingMs,
          timeSpent: 0,
        };

        const urgency = PriorityCalculator.calculateUrgency(
          pseudoTask, 
          config,
          allTags,
          allProjects,
          simulatedTime
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

    // Check for deadline misses: find tasks where the last scheduled split ends after the due date
    const deadlineMisses = this.checkDeadlineMisses(schedule, splits);

    return { schedule, deadlineMisses };
  },

  /**
   * Check for tasks that will miss their deadlines based on the schedule
   * @param {Array} schedule - The generated schedule
   * @param {Array} allSplits - All task splits (to check unscheduled tasks)
   * @returns {Array} - Array of deadline miss objects with task info and dates
   */
  checkDeadlineMisses(schedule, allSplits) {
    const deadlineMisses = [];
    
    // Group scheduled items by original task ID
    const scheduledByTask = new Map();
    for (const item of schedule) {
      const taskId = item.split.originalTaskId;
      if (!scheduledByTask.has(taskId)) {
        scheduledByTask.set(taskId, []);
      }
      scheduledByTask.get(taskId).push(item);
    }

    // Group all splits by original task ID to check for unscheduled splits
    const allSplitsByTask = new Map();
    for (const split of allSplits) {
      const taskId = split.originalTaskId;
      if (!allSplitsByTask.has(taskId)) {
        allSplitsByTask.set(taskId, []);
      }
      allSplitsByTask.get(taskId).push(split);
    }

    // Check each unique task
    const checkedTasks = new Set();
    
    for (const [taskId, scheduledItems] of scheduledByTask) {
      if (checkedTasks.has(taskId)) continue;
      checkedTasks.add(taskId);

      const originalTask = scheduledItems[0].split.originalTask;
      const dueDate = getTaskDueDate(originalTask);
      
      if (!dueDate) continue; // No deadline, no miss possible

      // Find the last scheduled end time for this task
      const lastEndTime = scheduledItems.reduce((latest, item) => {
        return item.endTime > latest ? item.endTime : latest;
      }, scheduledItems[0].endTime);

      // Check if all splits for this task are scheduled
      const allTaskSplits = allSplitsByTask.get(taskId) || [];
      const scheduledSplitIndices = new Set(scheduledItems.map(i => i.split.splitIndex));
      const unscheduledSplits = allTaskSplits.filter(s => !scheduledSplitIndices.has(s.splitIndex));

      // Task misses deadline if:
      // 1. The last scheduled split ends after the due date, OR
      // 2. Some splits couldn't be scheduled at all
      if (lastEndTime > dueDate || unscheduledSplits.length > 0) {
        deadlineMisses.push({
          taskId,
          taskTitle: originalTask.title,
          dueDate,
          scheduledCompletionDate: lastEndTime,
          unscheduledSplits: unscheduledSplits.length,
          totalSplits: allTaskSplits.length,
          missedBy: unscheduledSplits.length > 0 ? null : Math.ceil((lastEndTime - dueDate) / (1000 * 60 * 60 * 24)), // days
        });
      }
    }

    // Also check for tasks with deadlines that have NO scheduled splits at all
    for (const [taskId, splits] of allSplitsByTask) {
      if (checkedTasks.has(taskId)) continue;
      
      const originalTask = splits[0].originalTask;
      const dueDate = getTaskDueDate(originalTask);
      
      if (!dueDate) continue;

      // This task has a deadline but no splits were scheduled
      deadlineMisses.push({
        taskId,
        taskTitle: originalTask.title,
        dueDate,
        scheduledCompletionDate: null,
        unscheduledSplits: splits.length,
        totalSplits: splits.length,
        missedBy: null, // Unknown since nothing was scheduled
      });
    }

    return deadlineMisses;
  },
};

// ============================================================================
// TASK MERGE MODULE
// ============================================================================

export const TaskMerger = {
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
