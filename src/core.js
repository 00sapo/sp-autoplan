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
  // Dynamic scheduling options (auto-adjust urgency weight when deadlines can't be met)
  autoAdjustUrgency: true, // If true, reduce urgency weight when tasks can't meet deadlines
  urgencyWeight: 1.0, // Weight for non-deadline urgency factors (0.0 to 1.0)
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

// Time constants for calculations
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

// Urgency weight reduction step for auto-adjust scheduling
const URGENCY_WEIGHT_STEP = 0.1;

// Priority calculation constants
const MAX_ROMAN_NUMERAL = 3999;
const OLDNESS_EXPONENTIAL_CAP_DAYS = 100;
const OLDNESS_EXPONENTIAL_BASE = 1.1;

// Deadline priority thresholds (in days)
const DEADLINE_OVERDUE_THRESHOLD_DAYS = 7;
const DEADLINE_LINEAR_RANGE_DAYS = 21;

/**
 * Convert number to Roman numerals
 */
export function toRoman(num) {
  if (num <= 0) return 'I'; // Handle edge case - minimum is I
  if (num > MAX_ROMAN_NUMERAL) return String(num); // Roman numerals only go up to 3999
  
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
 * @description Utility function exported for external use and testing
 */
export function hoursBetween(date1, date2) {
  return Math.abs(date2 - date1) / MS_PER_HOUR;
}

/**
 * Calculate days between two dates
 */
export function daysBetween(date1, date2) {
  return Math.abs(date2 - date1) / MS_PER_DAY;
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
    return task.timeEstimate / MS_PER_HOUR;
  }
  return 0;
}

/**
 * Get remaining time in hours
 */
export function getRemainingHours(task) {
  const estimated = getEstimatedHours(task);
  const spent = task.timeSpent ? task.timeSpent / MS_PER_HOUR : 0;
  return Math.max(0, estimated - spent);
}

/**
 * Parse a deadline from task notes
 * Supports formats like:
 *   - "Due: 2024-01-20" or "due: 2024-01-20"
 *   - "Deadline: 2024-01-20" or "deadline: 2024-01-20"
 *   - "Due: Jan 20, 2024"
 *   - "Due: 20/01/2024" (DD/MM/YYYY)
 *   - "Due: 01/20/2024" (MM/DD/YYYY) - ambiguous, treated as MM/DD/YYYY
 * @param {string} notes - The notes field from a task
 * @returns {Date|null} The parsed due date or null if not found
 */
export function parseDeadlineFromNotes(notes) {
  if (!notes || typeof notes !== 'string') return null;
  
  // Match patterns like "Due: <date>" or "Deadline: <date>"
  const patterns = [
    // ISO format: Due: 2024-01-20 or Deadline: 2024-01-20
    /(?:due|deadline)\s*:\s*(\d{4}-\d{2}-\d{2})/i,
    // Named month: Due: Jan 20, 2024
    /(?:due|deadline)\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    // Slash format: Due: 01/20/2024 or 20/01/2024
    /(?:due|deadline)\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  
  for (const pattern of patterns) {
    const match = notes.match(pattern);
    if (match) {
      const dateStr = match[1];
      
      // Try parsing the date
      // Handle slash format specially (assume MM/DD/YYYY for US format)
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const [first, second, year] = parts.map(p => parseInt(p, 10));
          // Validate the parsed values
          if (first > 12 && second >= 1 && second <= 12) {
            // DD/MM/YYYY format (day > 12 indicates it's the day)
            return new Date(year, second - 1, first);
          }
          // MM/DD/YYYY format - validate day is reasonable
          if (first >= 1 && first <= 12 && second >= 1 && second <= 31) {
            return new Date(year, first - 1, second);
          }
          // Invalid date parts, continue to next pattern
        }
      } else {
        // Standard date parsing for other formats
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  }
  
  return null;
}

/**
 * Get the due date of a task
 * Priority:
 *   1. Deadline parsed from notes (allows setting deadline separately from scheduled time)
 *   2. dueDate field (Super Productivity's all-day due date)
 *   3. Note: dueWithTime is NOT used here because SP uses it for scheduling, not deadlines
 * 
 * @returns {Date|null} The due date or null if not set
 */
export function getTaskDueDate(task) {
  // First check for deadline in notes - this allows users to set deadlines
  // separately from the scheduled time (which uses dueWithTime in SP)
  const notesDeadline = parseDeadlineFromNotes(task.notes);
  if (notesDeadline) {
    return notesDeadline;
  }
  
  // Super Productivity's dueDate is for all-day due dates
  // Note: We don't use dueWithTime here because AutoPlan uses it for scheduling
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

/**
 * Check if a task has a specific tag
 * @param {Object} task - The task to check
 * @param {string} tagId - The tag ID to look for
 * @returns {boolean} True if the task has the tag
 */
export function hasTag(task, tagId) {
  return !!(tagId && task && task.tagIds && task.tagIds.includes(tagId));
}

/**
 * Check if a task is a fixed task (has the do-not-reschedule tag)
 * @param {Object} task - The task to check
 * @param {Object} config - Configuration object with doNotRescheduleTagId
 * @returns {boolean} True if the task should not be rescheduled
 */
export function isFixedTask(task, config) {
  return hasTag(task, config?.doNotRescheduleTagId);
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
        // Cap days to prevent overflow
        const cappedDays = Math.min(days, OLDNESS_EXPONENTIAL_CAP_DAYS);
        factor = Math.pow(OLDNESS_EXPONENTIAL_BASE, cappedDays);
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
   * Uses a configurable day range similar to taskcheck's urgency.due algorithm
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
    const daysUntilDue = (dueDate - now) / MS_PER_DAY;

    let factor;
    switch (formula) {
      case 'aggressive':
        // More aggressive urgency curve for very close deadlines
        // Overdue (7+ days overdue) = 1.0 (maximum)
        // Just due = 0.9
        // 1 week away = 0.5
        // 2+ weeks away = 0.2 (minimum)
        if (daysUntilDue <= -DEADLINE_OVERDUE_THRESHOLD_DAYS) {
          factor = 1.0;
        } else if (daysUntilDue <= 0) {
          // Overdue (0-7 days overdue): 0.9 to 1.0
          factor = 0.9 + (-daysUntilDue / DEADLINE_OVERDUE_THRESHOLD_DAYS) * 0.1;
        } else if (daysUntilDue <= DEADLINE_OVERDUE_THRESHOLD_DAYS) {
          // Within 1 week: 0.5 to 0.9
          factor = 0.9 - (daysUntilDue / DEADLINE_OVERDUE_THRESHOLD_DAYS) * 0.4;
        } else if (daysUntilDue <= DEADLINE_OVERDUE_THRESHOLD_DAYS * 2) {
          // Within 2 weeks: 0.2 to 0.5
          factor = 0.5 - ((daysUntilDue - DEADLINE_OVERDUE_THRESHOLD_DAYS) / DEADLINE_OVERDUE_THRESHOLD_DAYS) * 0.3;
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
        if (daysUntilDue <= -DEADLINE_OVERDUE_THRESHOLD_DAYS) {
          factor = 1.0;
        } else if (daysUntilDue >= DEADLINE_OVERDUE_THRESHOLD_DAYS * 2) {
          factor = 0.2;
        } else {
          // Linear interpolation from -7 days (1.0) to +14 days (0.2)
          // Range of 21 days maps to range of 0.8
          factor = 1.0 - ((daysUntilDue + DEADLINE_OVERDUE_THRESHOLD_DAYS) / DEADLINE_LINEAR_RANGE_DAYS) * 0.8;
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

    // Apply urgencyWeight to non-deadline factors (like taskcheck's weight_urgency)
    // This allows dynamic scheduling to prioritize deadline-based urgency when needed
    const urgencyWeight = config.urgencyWeight ?? 1.0;
    const nonDeadlineUrgency = (tagPriority + projectPriority + durationPriority + oldnessPriority) * urgencyWeight;

    return {
      total: nonDeadlineUrgency + deadlinePriority,
      components: {
        tag: tagPriority * urgencyWeight,
        project: projectPriority * urgencyWeight,
        duration: durationPriority * urgencyWeight,
        oldness: oldnessPriority * urgencyWeight,
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

      // First split inherits timeSpent and timeSpentOnDay from original task, others start empty
      const timeSpentMs = i === 0 ? (task.timeSpent || 0) : 0;
      const timeSpentOnDay = i === 0 ? (task.timeSpentOnDay || {}) : {};
      
      splits.push({
        originalTaskId: task.id,
        originalTask: task,
        splitIndex: i,
        totalSplits: numBlocks,
        title: splitName,
        estimatedHours: blockHours,
        estimatedMs: blockHours * 60 * 60 * 1000,
        timeSpentMs: timeSpentMs,
        timeSpentOnDay: timeSpentOnDay,
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
   * Calculate urgency for a split, considering total remaining work for the original task
   * @param {Object} split - The split to calculate urgency for
   * @param {Array} remainingSplits - All remaining unscheduled splits
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} simulatedTime - Current simulation time
   * @returns {Object} - { split, urgency, urgencyComponents, index }
   */
  calculateSplitUrgency(split, remainingSplits, config, allTags, allProjects, simulatedTime) {
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
    };
  },

  /**
   * Sort splits by urgency with deterministic tiebreakers
   * Primary: higher urgency first
   * Secondary: older tasks first (lower created timestamp)
   * Tertiary: alphabetical by task ID
   * @param {Array} splitsWithUrgency - Array of { split, urgency, urgencyComponents }
   * @returns {Array} - Sorted array (mutates in place)
   */
  sortSplitsByUrgency(splitsWithUrgency) {
    return splitsWithUrgency.sort((a, b) => {
      // Primary: higher urgency first
      if (b.urgency !== a.urgency) {
        return b.urgency - a.urgency;
      }
      // Secondary: older tasks first (lower created timestamp)
      const aCreated = a.split.originalTask?.created || 0;
      const bCreated = b.split.originalTask?.created || 0;
      if (aCreated !== bCreated) {
        return aCreated - bCreated;
      }
      // Tertiary: alphabetical by task ID for full determinism
      return (a.split.originalTaskId || '').localeCompare(b.split.originalTaskId || '');
    });
  },

  /**
   * Create a dynamic split for overflow time
   * @param {Object} mostUrgentSplit - The original split being split
   * @param {number} remainderMinutes - Minutes that don't fit in current day
   * @param {Array} remainingSplits - All remaining splits (will be updated)
   * @param {Object} config - Configuration object
   * @returns {Object} - The new split object
   */
  createDynamicSplit(mostUrgentSplit, remainderMinutes, remainingSplits, config) {
    const remainderHours = remainderMinutes / 60;
    const newSplitIndex = mostUrgentSplit.totalSplits; // Append at end
    
    // Update all splits for this task to reflect new total
    for (const split of remainingSplits) {
      if (split.originalTaskId === mostUrgentSplit.originalTaskId) {
        split.totalSplits = newSplitIndex + 1;
      }
    }
    
    // Determine the title for the new split
    let newSplitTitle = mostUrgentSplit.originalTask.title;
    if (config.splitPrefix) {
      newSplitTitle = config.splitPrefix + newSplitTitle;
    }
    if (config.splitSuffix !== false) {
      newSplitTitle = `${newSplitTitle} <${toRoman(newSplitIndex + 1)}>`;
    }
    
    const newSplit = {
      originalTaskId: mostUrgentSplit.originalTaskId,
      originalTask: mostUrgentSplit.originalTask,
      splitIndex: newSplitIndex,
      totalSplits: newSplitIndex + 1,
      title: newSplitTitle,
      estimatedHours: remainderHours,
      estimatedMs: remainderMinutes * 60 * 1000,
      tagIds: mostUrgentSplit.tagIds,
      projectId: mostUrgentSplit.projectId,
      parentId: mostUrgentSplit.parentId,
      prevSplitIndex: mostUrgentSplit.splitIndex,
      nextSplitIndex: null,
    };
    
    // Update the current split's next pointer
    mostUrgentSplit.nextSplitIndex = newSplitIndex;
    mostUrgentSplit.totalSplits = newSplitIndex + 1;
    
    return newSplit;
  },

  /**
   * Calculate the block start time from simulation state
   * @param {Date} simulatedTime - Current simulation date
   * @param {number} currentDayMinutes - Minutes into the workday
   * @param {number} workdayStartHour - Hour when workday starts
   * @returns {Date} - Start time for the block
   */
  calculateBlockStartTime(simulatedTime, currentDayMinutes, workdayStartHour) {
    const blockStartTime = new Date(simulatedTime);
    const totalMinutesFromMidnight = workdayStartHour * 60 + currentDayMinutes;
    blockStartTime.setHours(Math.floor(totalMinutesFromMidnight / 60));
    blockStartTime.setMinutes(totalMinutesFromMidnight % 60);
    blockStartTime.setSeconds(0);
    blockStartTime.setMilliseconds(0);
    return blockStartTime;
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
      // Calculate urgency for all remaining splits and sort by priority
      const splitsWithUrgency = remainingSplits.map(split => 
        this.calculateSplitUrgency(split, remainingSplits, config, allTags, allProjects, simulatedTime)
      );
      this.sortSplitsByUrgency(splitsWithUrgency);

      // Get the most urgent split
      const mostUrgent = splitsWithUrgency[0];
      let blockMinutes = mostUrgent.split.estimatedHours * 60;
      const minBlockMinutes = config.blockSizeMinutes ?? DEFAULT_CONFIG.blockSizeMinutes;
      const remainingMinutesToday = maxMinutesForCurrentDay - currentDayMinutes;

      // Check if we need to handle day overflow
      if (blockMinutes > remainingMinutesToday) {
        // Dynamic splitting: if remaining time today >= minimum block size,
        // schedule what fits today and create a new split for the remainder
        if (remainingMinutesToday >= minBlockMinutes) {
          // Schedule partial block for today, create new split for remainder
          const remainderMinutes = blockMinutes - remainingMinutesToday;
          blockMinutes = remainingMinutesToday;
          
          // Create a dynamic split for the overflow
          const newSplit = this.createDynamicSplit(
            mostUrgent.split, 
            remainderMinutes, 
            remainingSplits, 
            config
          );
          
          // Update the current split's estimated time
          mostUrgent.split.estimatedHours = blockMinutes / 60;
          mostUrgent.split.estimatedMs = blockMinutes * 60 * 1000;
          
          // Add new split to remainingSplits for future scheduling
          remainingSplits.push(newSplit);
        } else {
          // Not enough time today for minimum block, move to next day
          simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
          currentDayMinutes = 0;
          maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
          daysScheduled = daysBetween(startDate, simulatedTime);
          
          if (daysScheduled >= maxDaysAhead) {
            break; // Stop scheduling if we've exceeded max days
          }
          
          // If the new day has no available time (entirely filled by fixed tasks), skip it
          // Keep advancing until we find a day with available time or exceed maxDaysAhead
          while (maxMinutesForCurrentDay < minBlockMinutes && daysScheduled < maxDaysAhead) {
            simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
            maxMinutesForCurrentDay = getAvailableMinutesForDay(simulatedTime);
            daysScheduled = daysBetween(startDate, simulatedTime);
          }
          
          if (daysScheduled >= maxDaysAhead) {
            break;
          }
          
          // Continue to next iteration to re-evaluate with the new day
          continue;
        }
      }

      // Assign the block
      const blockStartTime = this.calculateBlockStartTime(simulatedTime, currentDayMinutes, workdayStartHour);
      
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

    // Check for deadline misses: identify tasks that will miss their deadlines
    // This includes tasks where scheduled completion is after the due date,
    // and tasks with unscheduled splits that couldn't fit in the scheduling window
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
          missedBy: unscheduledSplits.length > 0 ? null : Math.ceil((lastEndTime - dueDate) / MS_PER_DAY), // days
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

  /**
   * Schedule with automatic urgency adjustment
   * If tasks miss their deadlines, reduce the urgency weight and retry
   * until all deadlines are met or the weight reaches 0.
   * 
   * This implements taskcheck's auto-adjust-urgency feature.
   * 
   * @param {Array} splits - Task splits to schedule
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} startTime - When to start scheduling from
   * @param {Array} fixedTasks - Tasks that should not be rescheduled (optional)
   * @returns {Object} - { schedule, deadlineMisses, finalUrgencyWeight, adjustmentAttempts }
   */
  scheduleWithAutoAdjust(splits, config, allTags, allProjects = [], startTime = new Date(), fixedTasks = []) {
    const autoAdjust = config.autoAdjustUrgency ?? true;
    const initialWeight = config.urgencyWeight ?? 1.0;
    
    if (!autoAdjust) {
      // No auto-adjust, just run once
      const result = this.schedule(splits, config, allTags, allProjects, startTime, fixedTasks);
      return {
        ...result,
        finalUrgencyWeight: initialWeight,
        adjustmentAttempts: 0,
      };
    }
    
    let currentWeight = initialWeight;
    let attempts = 0;
    let result;
    
    // Keep trying with reduced weight until no deadline misses or weight reaches 0
    while (currentWeight >= 0) {
      // Create a modified config with current weight
      const adjustedConfig = {
        ...config,
        urgencyWeight: currentWeight,
      };
      
      result = this.schedule(splits, adjustedConfig, allTags, allProjects, startTime, fixedTasks);
      
      // If no deadline misses, we're done
      if (result.deadlineMisses.length === 0) {
        break;
      }
      
      // Reduce weight by the step amount and try again
      currentWeight = Math.round((currentWeight - URGENCY_WEIGHT_STEP) * 10) / 10; // Round to avoid floating point issues
      attempts++;
      
      // Safety check - don't go below 0
      if (currentWeight < 0) {
        currentWeight = 0;
        // One final try with weight = 0
        const finalConfig = { ...config, urgencyWeight: 0 };
        result = this.schedule(splits, finalConfig, allTags, allProjects, startTime, fixedTasks);
        break;
      }
    }
    
    return {
      ...result,
      finalUrgencyWeight: currentWeight,
      adjustmentAttempts: attempts,
    };
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
   * Clean AutoPlan markers from task notes
   * Removes lines containing [AutoPlan] and related metadata like "Original Task ID:"
   * Also removes "Split X/Y of" lines
   * @param {string} notes - The original notes
   * @returns {string} Cleaned notes with AutoPlan markers removed
   */
  cleanAutoplanNotes(notes) {
    if (!notes) return '';
    
    // Split into lines and filter out AutoPlan-related lines
    const lines = notes.split('\n');
    const cleanedLines = lines.filter(line => {
      const trimmed = line.trim();
      // Remove lines with [AutoPlan] marker
      if (trimmed.includes('[AutoPlan]')) return false;
      // Remove "Original Task ID:" lines
      if (trimmed.startsWith('Original Task ID:')) return false;
      // Remove "Split X/Y of" lines (the split task markers)
      if (/^Split \d+\/\d+ of "/.test(trimmed)) return false;
      return true;
    });
    
    // Join and trim excess whitespace
    return cleanedLines.join('\n').trim();
  },

  /**
   * Generate the notes content for a split task
   */
  generateSplitNotes(splitIndex, totalSplits, originalTitle, originalTaskId) {
    const escapedTitle = this.escapeTitle(originalTitle);
    return `[AutoPlan] Split ${splitIndex + 1}/${totalSplits} of "${escapedTitle}"\n\n[AutoPlan] Original Task ID: ${originalTaskId}`;
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
   * Merge multiple timeSpentOnDay objects into one
   * Each timeSpentOnDay is an object like { "2024-01-15": 3600000, "2024-01-16": 1800000 }
   * @param {Array} timeSpentOnDayObjects - Array of timeSpentOnDay objects to merge
   * @returns {Object} Combined timeSpentOnDay with summed values for each day
   */
  mergeTimeSpentOnDay(timeSpentOnDayObjects) {
    const merged = {};
    for (const timeSpentOnDay of timeSpentOnDayObjects) {
      if (!timeSpentOnDay || typeof timeSpentOnDay !== 'object') continue;
      for (const [day, ms] of Object.entries(timeSpentOnDay)) {
        merged[day] = (merged[day] || 0) + (ms || 0);
      }
    }
    return merged;
  },

  /**
   * Calculate merged task data from splits
   * @param {Array} incompleteSplits - Splits that are not done (for time estimate)
   * @param {Array} allSplits - All splits including completed ones (for time spent)
   * @param {string} originalTitle - The original task title
   */
  calculateMergeData(incompleteSplits, allSplits, originalTitle) {
    let totalTimeEstimate = 0;
    let totalTimeSpent = 0;
    
    // Sum time estimates from incomplete splits only (remaining work)
    for (const split of incompleteSplits) {
      totalTimeEstimate += split.timeEstimate || 0;
    }
    
    // Sum time spent from ALL splits including completed ones
    for (const split of allSplits) {
      totalTimeSpent += split.timeSpent || 0;
    }
    
    // Merge timeSpentOnDay from ALL splits
    const mergedTimeSpentOnDay = this.mergeTimeSpentOnDay(
      allSplits.map(s => s.timeSpentOnDay)
    );

    // Clean title by removing Roman numeral suffix in <> brackets
    // Pattern: " <I>", " <II>", " <XIV>", etc.
    const cleanTitle = originalTitle || incompleteSplits[0]?.title?.replace(/ <[IVXLCDM]+>$/, '') || 'Merged Task';

    return {
      title: cleanTitle,
      totalTimeEstimate,
      totalTimeSpent,
      totalTimeSpentOnDay: mergedTimeSpentOnDay,
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
