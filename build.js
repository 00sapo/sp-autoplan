#!/usr/bin/env node
/**
 * Build script for AutoPlan plugin
 * Bundles src/core.js into plugin/plugin.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read core.js and strip ES module syntax
let coreCode = readFileSync(join(__dirname, 'src/core.js'), 'utf-8');

// Remove export keywords
coreCode = coreCode.replace(/^export\s+/gm, '');
coreCode = coreCode.replace(/^export\s*{\s*[\w\s,]+\s*};?\s*$/gm, '');

// Read plugin template
const pluginTemplate = readFileSync(join(__dirname, 'src/plugin-template.js'), 'utf-8');

// Combine: core code + plugin-specific code
const pluginCode = `/**
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

${coreCode}

${pluginTemplate}
`;

// Write plugin.js
writeFileSync(join(__dirname, 'plugin/plugin.js'), pluginCode);

console.log('Built plugin/plugin.js successfully');
