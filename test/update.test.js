'use strict';
// Exercises scripts/update.js against a local bare repo standing in for GitHub.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { update } = require('../scripts/update');
const { readVersionFile, readVersionInfo, versionLabels } = require('../src/shared/version');

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speck-update-'));
  const remote = path.join(tmp, 'github.git');
  const dev = path.join(tmp, 'dev');
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(tmp, 'clone', '--quiet', remote, dev);
  git(dev, 'checkout', '--quiet', '-B', 'main');
  write(dev, 'package.json', '{"version":"1.0.0"}');
  write(dev, 'app.txt', 'v1');
  git(dev, 'add', '.');
  git(dev, 'commit', '--quiet', '-m', 'v1');
  git(dev, 'push', '--quiet', 'origin', 'main');
  const publish = (version, text) => {
    write(dev, 'package.json', `{"version":"${version}"}`);
    write(dev, 'app.txt', text);
    git(dev, 'commit', '--quiet', '-am', text);
    git(dev, 'push', '--quiet', 'origin', 'main');
    return git(dev, 'rev-parse', 'HEAD');
  };
  const userClone = (name = 'user') => {
    const dir = path.join(tmp, name);
    git(tmp, 'clone', '--quiet', remote, dir);
    return dir;
  };
  return { tmp, remote, dev, publish, userClone };
}

test('updates an old copy to the latest main and records the version', () => {
  const g = setup();
  const user = g.userClone();
  const latest = g.publish('1.1.0', 'v2');
  const r = update(user, { repoUrl: g.remote });
  assert.equal(r.status, 'updated');
  assert.equal(git(user, 'rev-parse', 'HEAD'), latest);
  assert.equal(read(user, 'app.txt'), 'v2');
  const v = readVersionFile(user);
  assert.equal(v.commit, latest.slice(0, 7));
  assert.equal(v.version, '1.1.0');
  assert.equal(v.check, 'ok');
  assert.ok(v.commitDate);
  assert.equal(update(user, { repoUrl: g.remote }).status, 'current', 'second run is a no-op');
});

test('switches from an old working branch to main', () => {
  const g = setup();
  const user = g.userClone();
  git(user, 'checkout', '--quiet', '-b', 'claude/old-branch');
  const latest = g.publish('1.1.0', 'v2');
  assert.equal(update(user, { repoUrl: g.remote }).status, 'updated');
  assert.equal(git(user, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(git(user, 'rev-parse', 'HEAD'), latest);
});

test('local edits to Speck files never block an update; downloaded files are kept', () => {
  const g = setup();
  const user = g.userClone();
  write(user, 'app.txt', 'edited by accident');
  fs.mkdirSync(path.join(user, 'node_modules'));
  write(path.join(user, 'node_modules'), 'keep.txt', 'x');
  g.publish('1.1.0', 'v2');
  assert.equal(update(user, { repoUrl: g.remote }).status, 'updated');
  assert.equal(read(user, 'app.txt'), 'v2');
  assert.equal(read(path.join(user, 'node_modules'), 'keep.txt'), 'x');
});

test('a ZIP download (no .git) becomes an updatable clone', () => {
  const g = setup();
  const zip = path.join(g.tmp, 'speck-tool-main');
  fs.mkdirSync(zip);
  write(zip, 'package.json', '{"version":"1.0.0"}');
  write(zip, 'app.txt', 'v1');
  const latest = g.publish('1.1.0', 'v2');
  const r = update(zip, { repoUrl: g.remote });
  assert.ok(['updated', 'current'].includes(r.status));
  assert.equal(git(zip, 'rev-parse', 'HEAD'), latest);
  assert.equal(read(zip, 'app.txt'), 'v2');
  assert.equal(git(zip, 'remote', 'get-url', 'origin'), g.remote);
});

test('offline: keeps the current version and says so', () => {
  const g = setup();
  const user = g.userClone();
  const before = git(user, 'rev-parse', 'HEAD');
  git(user, 'remote', 'set-url', 'origin', path.join(g.tmp, 'does-not-exist.git'));
  const r = update(user, { repoUrl: g.remote });
  assert.equal(r.status, 'offline');
  assert.equal(git(user, 'rev-parse', 'HEAD'), before);
  assert.equal(readVersionFile(user).check, 'offline');
  assert.match(versionLabels(readVersionInfo(user)).join('|'), /Couldn't check for updates/);
});

test('recognizes a private repo without a login', () => {
  const { isAuthError } = require('../scripts/update');
  assert.ok(isAuthError("fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
  assert.ok(isAuthError("remote: Repository not found.\nfatal: repository 'https://github.com/x/y.git/' not found"));
  assert.ok(!isAuthError('fatal: unable to access: Could not resolve host: github.com'));
  assert.deepEqual(versionLabels({ version: '1', commit: 'abc', check: 'auth' }).slice(-1), ['Updates blocked: GitHub needs a login']);
});

test('menu labels show version, commit, update date and last check', () => {
  const g = setup();
  const user = g.userClone();
  g.publish('2.3.4', 'v2');
  update(user, { repoUrl: g.remote });
  const info = readVersionInfo(user);
  const labels = versionLabels(info);
  assert.equal(labels[0], `Speck v2.3.4 (${git(user, 'rev-parse', '--short=7', 'HEAD')})`);
  assert.match(labels[1], /^Updated [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/);
  assert.match(labels[2], /^Up to date · checked just now$/);
});

test('menu shows the update date even without a launcher-written file', () => {
  const g = setup();
  const user = g.userClone();
  assert.equal(readVersionFile(user), null);
  assert.match(versionLabels(readVersionInfo(user))[1], /^Updated /);
});

test('reads the commit from packed refs without git', () => {
  const g = setup();
  const user = g.userClone();
  git(user, 'pack-refs', '--all');
  fs.rmSync(path.join(user, '.git', 'refs', 'heads', 'main'), { force: true });
  assert.equal(readVersionInfo(user).commit, git(user, 'rev-parse', '--short=7', 'HEAD'));
});
