/**
 * AutoPlan - Core Library (testable, no PluginAPI dependencies)
 */

// ============================================================================
// CONFIGURATION DEFAULTS
// ============================================================================

export const DEFAULT_CONFIG = {
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
   * Calculate base priority from task order (N+1-r where N is total tasks, r is rank)
   */
  calculateBasePriority(task, allTasks) {
    const totalTasks = allTasks.length;
    const rank = allTasks.findIndex(t => t.id === task.id) + 1;
    if (rank === 0) return 0; // Task not found
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
   */
  calculateUrgency(task, allTasks, config, allTags, now = new Date()) {
    const basePriority = this.calculateBasePriority(task, allTasks);
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
        splitName = `${splitName} ${toRoman(i + 1)}`;
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
   * Main scheduling algorithm
   * Assigns time blocks to the most urgent tasks iteratively
   */
  schedule(splits, config, allTags, startTime = new Date()) {
    if (splits.length === 0) return [];

    const schedule = [];
    const remainingSplits = [...splits];
    let simulatedTime = new Date(startTime);
    
    const workdayStartHour = config.workdayStartHour ?? 9;
    const maxMinutesPerDay = (config.workdayHours ?? 8) * 60;
    const maxDaysAhead = config.maxDaysAhead ?? 30;
    const skipDays = config.skipDays ?? [];
    
    // Start from current time if during work hours
    let currentDayMinutes = this.getCurrentDayMinutes(simulatedTime, workdayStartHour);
    
    // If we're past work hours or current day minutes exceeds max, move to next workday
    if (currentDayMinutes >= maxMinutesPerDay) {
      simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
      currentDayMinutes = 0;
    } else if (this.shouldSkipDay(simulatedTime, skipDays)) {
      // If starting on a skip day, find the next valid workday
      // We use a temp date set to previous day so advanceToNextWorkday lands on correct day
      const tempDate = new Date(simulatedTime);
      tempDate.setDate(tempDate.getDate() - 1);
      simulatedTime = this.advanceToNextWorkday(tempDate, skipDays, workdayStartHour);
      currentDayMinutes = 0;
    }
    
    const startDate = new Date(simulatedTime);
    let daysScheduled = 0;

    while (remainingSplits.length > 0 && daysScheduled < maxDaysAhead) {
      // Get unique original task IDs in their original order (for base priority calculation)
      const originalTaskOrder = [];
      const seenTaskIds = new Set();
      for (const split of remainingSplits) {
        if (!seenTaskIds.has(split.originalTaskId)) {
          seenTaskIds.add(split.originalTaskId);
          originalTaskOrder.push(split.originalTask);
        }
      }

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
          id: split.originalTaskId, // Use original task ID for base priority lookup
          timeEstimate: totalRemainingMs,
          timeSpent: 0,
        };

        const urgency = PriorityCalculator.calculateUrgency(
          pseudoTask, 
          originalTaskOrder, // Pass original tasks for base priority calculation
          config,
          allTags,
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
      if (currentDayMinutes + blockMinutes > maxMinutesPerDay) {
        simulatedTime = this.advanceToNextWorkday(simulatedTime, skipDays, workdayStartHour);
        currentDayMinutes = 0;
        daysScheduled = daysBetween(startDate, simulatedTime);
        
        if (daysScheduled >= maxDaysAhead) {
          break; // Stop scheduling if we've exceeded max days
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

    // Clean title by removing Roman numeral suffix
    // Be careful not to remove valid text - only remove if preceded by space
    const cleanTitle = originalTitle || incompleteSplits[0]?.title?.replace(/ [IVXLCDM]+$/, '') || 'Merged Task';

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
