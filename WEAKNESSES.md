# AutoPlan Plugin - Weakness Analysis

## Critical Issues

### 1. **Original Task Not Removed/Handled Properly** (plugin.js:433-436)
- **Problem**: When tasks are split, the original task is only updated with a note, but it's NOT removed or marked as done. This means:
  - The original task will still appear in the task list
  - Running AutoPlan again will re-process it, creating duplicate splits
  - Users will see both the original and split tasks

### 2. **No Duplicate Detection** (plugin.js:644-714)
- **Problem**: There's no check to see if a task has already been split
- Running AutoPlan multiple times will create multiple sets of splits

### 3. **Task Scheduling Ignores Current Time of Day** (plugin.js:295-297)
- **Problem**: `simulatedTime = new Date()` uses current time, but `currentDayMinutes = 0` 
- This means if you run at 3 PM, it will schedule from 12 AM, not from 3 PM
- The taskcheck algorithm specifically handles this case

### 4. **toRoman(0) Returns Empty String** (plugin.js:38-52)
- **Problem**: If `num` is 0, returns empty string
- Edge case that could cause issues with task naming

### 5. **Exponential Oldness Can Overflow** (plugin.js:161-162)
- **Problem**: `Math.pow(1.1, days)` for a 100-day old task = 13,780
- For 365 days = 1.17 × 10^15 - essentially infinity
- This will completely dominate the priority calculation

### 6. **No maxDaysAhead Enforcement** (plugin.js:290-369)
- **Problem**: Config has `maxDaysAhead` but it's never used in the scheduling algorithm
- Schedule could extend indefinitely

### 7. **Split Regex May Fail** (plugin.js:456)
- **Problem**: If task title contains quotes or special characters, the regex match will fail
- Pattern: `/Split (\d+)\/(\d+) of "(.+)"\n\nOriginal Task ID: (.+)/`
- Title with quote: `Task "important"` → will break

### 8. **Roman Numeral Regex Too Greedy** (plugin.js:547)
- **Problem**: `/ [IVXLCDM]+$/` could match valid text ending in these letters
- Example: "Study CIVIL LAW" → becomes "Study"

## Medium Issues

### 9. **No Validation of blockSizeMinutes** 
- Zero or negative values could cause infinite loops or division by zero

### 10. **Base Priority Calculation Unstable** (plugin.js:104-108)
- Priority depends on array order, which changes as splits are removed
- Could cause inconsistent scheduling

### 11. **No Working Hours Configuration**
- Hardcoded 8-hour workday (plugin.js:297)
- Hardcoded 9 AM start time (plugin.js:336)
- No weekend handling

### 12. **Missing Error Handling in applySchedule**
- If one task fails to update, the whole operation fails
- No rollback mechanism

### 13. **Performance Issue in schedule()** (plugin.js:299-367)
- O(n²) algorithm - recalculates urgency for ALL tasks on each iteration
- Could be slow with many tasks/splits

## Minor Issues

### 14. **hoursBetween Function Unused** (plugin.js:57-59)
- Dead code

### 15. **splitPrefix Config Unused** (plugin.js:27, 223-225)
- Config option exists but is never applied

### 16. **No Timezone Handling**
- Uses local timezone which could cause issues

### 17. **UI/Plugin Communication May Fail**
- `window.parent.AutoPlanAPI` access assumes iframe is child of plugin context
