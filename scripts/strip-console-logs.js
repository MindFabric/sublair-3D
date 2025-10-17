#!/usr/bin/env node

/**
 * Strips console.log, console.debug, console.info, and console.trace
 * from index.html for production deployment
 */

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '../index.html');
const backupPath = path.join(__dirname, '../index.html.backup');

console.log('🧹 Stripping console logs from index.html...');

// Read index.html
let content = fs.readFileSync(indexPath, 'utf8');

// Backup original file
fs.writeFileSync(backupPath, content);
console.log('💾 Backup saved to index.html.backup');

// Count original console statements
const originalLogs = (content.match(/console\.(log|debug|info|trace)/g) || []).length;
console.log(`📊 Found ${originalLogs} console statements`);

// Remove console.log, console.debug, console.info, console.trace statements
// This regex matches entire console statements including their semicolons
content = content.replace(/console\.(log|debug|info|trace)\s*\([^)]*\);?\s*/g, '');

// Count remaining console statements (should only be error/warn)
const remainingLogs = (content.match(/console\.(log|debug|info|trace)/g) || []).length;
const removedLogs = originalLogs - remainingLogs;

console.log(`✅ Removed ${removedLogs} console statements`);
console.log(`✅ Kept console.error and console.warn statements`);

// Write cleaned file
fs.writeFileSync(indexPath, content);
console.log('✨ index.html cleaned for production!');
