# AutoPlan - Automatic Task Scheduler for Super Productivity

A plugin for [Super Productivity](https://super-productivity.com/) that automatically schedules and prioritizes your tasks based on urgency.

## Features

- **Urgency-based scheduling**: Tasks are prioritized based on multiple factors:
  - Base priority from task order in the list
  - Tag-based priority boosts (configurable)
  - Duration factor (shorter or longer tasks can be prioritized)
  - Oldness factor (older tasks can get higher priority)

- **Task splitting**: Large tasks are split into configurable time blocks (default 2 hours)
  - Split tasks are named with Roman numerals (e.g., "Task I", "Task II")
  - Split tasks can be merged back together

- **Workday-aware scheduling**:
  - Configurable work hours (default 9am-5pm)
  - Skip days (default: weekends)
  - Maximum days ahead limit

- **Preview before applying**: See exactly what will be scheduled before making changes

## Installation

1. Download `sp-autoplan-plugin.zip` from the releases
2. In Super Productivity, go to **Settings > Plugins**
3. Click **"Load Plugin from Folder"** and select the extracted folder
4. The plugin will appear in the side panel

## Usage

### Quick Start

1. Click the magic wand icon in the side panel to open AutoPlan
2. Click **"Run AutoPlan Now"** to schedule your tasks
3. Tasks with time estimates will be split and scheduled

### Settings

#### Block Settings
- **Block Size**: How long each time block should be (default: 120 minutes)
- **Max Days Ahead**: How far into the future to schedule (default: 30 days)
- **Auto-run on startup**: Automatically run scheduling when Super Productivity starts

#### Work Schedule
- **Workday Start Hour**: When your workday begins (default: 9)
- **Workday Length**: How many hours you work per day (default: 8)
- **Skip Days**: Days to exclude from scheduling (default: Saturday, Sunday)

#### Tag Priorities
Assign priority boosts to tags:
- Positive values increase priority
- Negative values decrease priority
- Example: "urgent" tag with +20 priority boost

#### Priority Formulas
Configure how duration and oldness affect priority:

**Duration Formula**:
- `None`: Duration doesn't affect priority
- `Linear`: Priority proportional to hours
- `Inverse`: Shorter tasks get higher priority
- `Logarithmic`: Diminishing returns for longer tasks

**Oldness Formula**:
- `None`: Age doesn't affect priority
- `Linear`: Priority proportional to days old
- `Logarithmic`: Diminishing returns for older tasks
- `Exponential`: Rapidly increasing priority for old tasks

### Previewing the Schedule

1. Go to the **Schedule** tab
2. Click **"Generate Preview"**
3. See exactly what will be scheduled, grouped by date
4. If satisfied, click **"Run AutoPlan Now"**

### Merging Split Tasks

If you need to undo a split or consolidate remaining work:

1. Go to the **Merge Tasks** tab
2. Click **"Refresh Split Groups"** to see all split task groups
3. Click **"Merge"** on any group to combine incomplete splits

## Keyboard Shortcuts

- `Ctrl+Shift+A`: Open AutoPlan panel

## Development

### Project Structure

```
sp-autoplan/
├── src/
│   ├── core.js           # Core library (testable, no PluginAPI)
│   └── plugin-template.js # Plugin-specific code (uses PluginAPI)
├── plugin/
│   ├── manifest.json     # Plugin metadata
│   ├── plugin.js         # Generated from core.js + plugin-template.js
│   ├── index.html        # Settings UI
│   └── icon.svg          # Plugin icon
├── tests/                # Test files
├── build.js              # Build script
└── package.json
```

### Building

```bash
npm install
npm run build        # Generate plugin/plugin.js
npm run build:zip    # Build and create zip file
```

### Testing

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
```

### How It Works

1. **Priority Calculation**: Each task gets a priority score:
   ```
   Priority = BasePriority + TagBoosts + DurationFactor + OldnessFactor
   ```

2. **Task Splitting**: Tasks are split into blocks of configurable size

3. **Scheduling Algorithm**:
   - Get the most urgent task
   - Assign it to the next available time slot
   - Recalculate urgencies (remaining time decreased)
   - Repeat until all blocks are scheduled

## License

ISC

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
