# AutoPlan - Automatic Task Scheduler for Super Productivity

Intelligently schedule your tasks based on urgency. Inspired by the proven approach of [taskcheck](https://github.com/00sapo/taskcheck) for taskwarrior.

## Installation

1. Download `sp-autoplan-plugin.zip` from the [latest release](https://github.com/00sapo/sp-autoplan/releases/latest)
2. In Super Productivity: **Settings > Plugin > Load Plugin**
3. Enable the AutoPlan plugin
4. Click on the AutoPlan button (🪄) in the top bar

## Quick Start

1. Add time estimates to your tasks (required for scheduling)
2. Click **"Run AutoPlan Now"**
3. Your tasks are split into blocks and scheduled to your calendar

That's it. I strongly recommend to adjust the settings and save them. Each option in the UI is
self-explained.

## Features

- ⚡ **Automatic scheduling** based on tags, projects, duration, and age
- 🔄 **Smart task splitting** into manageable time blocks (default 2 hours)
- 📅 **Calendar-aware** with configurable work hours and days off
- 🛡️ **Safe re-running** — automatically merges splits and clears previous schedules
- 🏷️ **Flexible priorities** through tags and projects instead of numeric fields

## How It Works

1. Clear previous schedules and merge any split tasks
2. Calculate urgency for each task based on:
   - Tag boosts (add +20 to "urgent" tag)
   - Project boosts (add +15 to "Work" project)
   - Duration (prefer quick wins or tackle big tasks)
   - Age (prevent old tasks being forgotten)
3. Split large tasks into blocks
4. Schedule blocks in urgency order

## Settings (All Optional)

**Basic**: Block size, max days ahead, work hours, days off

**Tags & Projects**: Add priority boosts (e.g., "urgent" +20, "low-priority" -10)

**Formulas**: Advanced control of how duration and age affect priority

**Do Not Reschedule**: Tag tasks with a "fixed" tag to keep them scheduled (meetings, etc.)

Use the **Schedule** tab to preview what will be scheduled before applying changes.

## Important Caveats

**Super Productivity has no priority field.** AutoPlan rebuilds urgency using tags, projects, task elderliness, and estimated completion time. Use the dry-run preview to verify the schedule matches your expectations.

**Super Productivity doesn't support scheduling tasks only partially.** AutoPlan splits large tasks into `Task <I>`, `Task <II>`, etc. This means:
- Task count changes each run
- Could conflict with other plugins that manipulate tasks
- Use the Merge tab to manually consolidate if needed

**Super Conductivity still has primitive calendar integration.** Import calendar events as tasks with a "fixed" tag to protect them from AutoPlan.

**Super Productivity Plugin API are limited.** Especially, they don't expose settings that would be
useful for improving AutoPlan (working hours, weekdays, boards). This leads to replicate the working
hours settings and to the impossibility of having priority given by our custom list order.

## Development

```bash
npm install
npm run build        # Generate plugin/plugin.js
npm run build:zip    # Create release zip
npm test             # Run tests
```

## License

GPL-3.0
