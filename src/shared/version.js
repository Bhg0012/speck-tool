'use strict';
// Version info shown in the right-click menu. Written by scripts/update.js on every launch.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FILE = '.speck-version.json';

function readVersionFile(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeVersionFile(root, info) {
  try {
    fs.writeFileSync(path.join(root, FILE), JSON.stringify(info, null, 2));
  } catch {
    // read-only folder: the menu falls back to package.json + .git
  }
}

// Reads the current commit straight from .git (works even when git isn't on PATH).
function gitHead(root) {
  try {
    const gitDir = path.join(root, '.git');
    const headRef = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!headRef.startsWith('ref:')) return headRef;
    const ref = headRef.slice(4).trim();
    const loose = path.join(gitDir, ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0] : null;
  } catch {
    return null;
  }
}

// A git that won't pop up macOS's "install developer tools" dialog.
function safeGit() {
  if (process.platform !== 'darwin') return 'git';
  const real = [
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/Library/Developer/CommandLineTools/usr/bin/git',
    '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
  ];
  return real.find((p) => fs.existsSync(p)) || null;
}

function readVersionInfo(root) {
  let pkg = '';
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {
    // ignore
  }
  const file = readVersionFile(root) || {};
  const live = gitHead(root);
  const commit = live ? live.slice(0, 7) : file.commit || '';
  // The file describes the commit it was written for; ignore its date if the code changed since.
  const sameBuild = !live || !file.commit || live.startsWith(file.commit);
  let commitDate = sameBuild ? file.commitDate || '' : '';
  const git = safeGit();
  if (!commitDate && live && git) {
    // Started without a launcher (or the file is stale): ask git directly.
    const r = spawnSync(git, ['log', '-1', '--format=%cI'], { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (r.status === 0) commitDate = r.stdout.trim();
  }
  return {
    version: pkg || file.version || '',
    commit,
    commitDate,
    check: file.check || '',
    checkedAt: file.checkedAt || '',
  };
}

function fmt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function ago(iso, now) {
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return fmt(iso);
}

// Lines for the right-click menu.
function versionLabels(info, now = Date.now()) {
  const lines = [`Speck v${info.version || '?'}${info.commit ? ` (${info.commit})` : ''}`];
  if (info.commitDate) lines.push(`Updated ${fmt(info.commitDate)}`);
  if (info.check === 'ok' && info.checkedAt) lines.push(`Up to date · checked ${ago(info.checkedAt, now)}`);
  else if (info.check === 'offline') lines.push(`Couldn't check for updates · ${ago(info.checkedAt, now)}`);
  else if (info.check === 'auth') lines.push('Updates blocked: GitHub needs a login');
  else if (info.check === 'no-git') lines.push('Auto-update off: Git is not installed');
  else if (info.check === 'failed') lines.push('Last update failed. Start from the launcher');
  return lines;
}

module.exports = { readVersionFile, writeVersionFile, readVersionInfo, versionLabels, gitHead, FILE };
