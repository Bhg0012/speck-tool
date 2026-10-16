'use strict';
// Keeps the local Speck folder identical to the latest `main` on GitHub.
// Used by scripts/start.js, which every launcher (Mac, Windows, Speck.app) runs.
//
// - fetches origin/main and force-switches to it (local edits to Speck's own files are discarded,
//   so a stray change, line-ending difference or old branch can never block an update)
// - turns a ZIP-downloaded copy (no .git folder) into a proper clone so it can update too
// - records version info in .speck-version.json for the right-click menu

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeVersionFile, readVersionFile } = require('../src/shared/version');

const REPO_URL = 'https://github.com/Bhg0012/speck-tool.git';
const BRANCH = 'main';

function run(cmd, args, cwd, timeout = 60000) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
  });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || (r.error && r.error.message) || '').trim() };
}

let GIT = 'git';

// Finds a working git. On a Mac without developer tools, /usr/bin/git is a stub that pops up
// an install dialog, so it doesn't count. On Windows, git may be installed but not on PATH yet.
function gitAvailable() {
  if (process.platform === 'darwin') {
    const which = run('which', ['git'], process.cwd(), 5000).out;
    if (!which) return false;
    if (which === '/usr/bin/git' && !run('xcode-select', ['-p'], process.cwd(), 5000).ok) return false;
  }
  const candidates = ['git'];
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (base) candidates.push(path.join(base, 'Git', 'cmd', 'git.exe'));
    }
  }
  for (const c of candidates) {
    if (run(c, ['--version'], process.cwd(), 10000).ok) {
      GIT = c;
      return true;
    }
  }
  return false;
}

function head(root) {
  const r = run(GIT, ['rev-parse', 'HEAD'], root, 10000);
  return r.ok ? r.out : null;
}

function packageVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  } catch {
    return '';
  }
}

function record(root, check, extra = {}) {
  const prev = readVersionFile(root) || {};
  const commit = head(root);
  const date = commit ? run(GIT, ['log', '-1', '--format=%cI'], root, 10000).out : '';
  const info = {
    version: packageVersion(root),
    commit: commit ? commit.slice(0, 7) : prev.commit || '',
    commitDate: date || prev.commitDate || '',
    check, // 'ok' | 'offline' | 'no-git' | 'failed'
    checkedAt: new Date().toISOString(),
    installedAt: extra.updated ? new Date().toISOString() : prev.installedAt || new Date().toISOString(),
  };
  writeVersionFile(root, info);
  return info;
}

/**
 * Updates `root` to the latest origin/main.
 * @returns {{ status: 'updated'|'current'|'offline'|'no-git'|'failed', from?: string, to?: string, message?: string }}
 */
function update(root, { repoUrl = REPO_URL, branch = BRANCH } = {}) {
  if (process.env.SPECK_NO_UPDATE === '1') return { status: 'current' };
  if (!gitAvailable()) {
    record(root, 'no-git');
    return { status: 'no-git' };
  }

  // ZIP download: make it a real clone in place.
  if (!fs.existsSync(path.join(root, '.git'))) {
    if (!run(GIT, ['init', '--quiet'], root).ok) {
      record(root, 'failed');
      return { status: 'failed', message: 'git init failed' };
    }
  }
  const origin = run(GIT, ['remote', 'get-url', 'origin'], root, 10000);
  if (!origin.ok) run(GIT, ['remote', 'add', 'origin', repoUrl], root, 10000);

  const from = head(root);
  const fetched = run(GIT, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], root, 90000);
  if (!fetched.ok) {
    record(root, 'offline');
    return { status: 'offline', from, message: fetched.err.split('\n').pop() };
  }

  const target = run(GIT, ['rev-parse', `refs/remotes/origin/${branch}`], root, 10000).out;
  const onBranch = run(GIT, ['symbolic-ref', '--quiet', '--short', 'HEAD'], root, 10000).out === branch;
  const dirty = run(GIT, ['status', '--porcelain', '--untracked-files=no'], root, 10000).out !== '';
  if (from === target && onBranch && !dirty) {
    record(root, 'ok');
    return { status: 'current', from, to: target };
  }

  const co = run(GIT, ['checkout', '--quiet', '-f', '-B', branch, `refs/remotes/origin/${branch}`], root, 60000);
  if (!co.ok) {
    record(root, 'failed');
    return { status: 'failed', from, message: co.err.split('\n').pop() };
  }
  run(GIT, ['branch', '--quiet', `--set-upstream-to=origin/${branch}`, branch], root, 10000);
  const to = head(root);
  record(root, 'ok', { updated: from !== to });
  return { status: from !== to ? 'updated' : 'current', from, to };
}

module.exports = { update, gitAvailable, REPO_URL, BRANCH };
