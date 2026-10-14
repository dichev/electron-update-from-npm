// check() reports a newer release on npm or in a git source's tags, only for an `npm i -g` install (and dev,
// for debugging), and install() installs it through installer.js. These tests pin who is asked, when a version
// counts as newer, which failures stay silent and which reach the user, and what the installer is handed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted, so the mocked modules share them
const mocks = vi.hoisted(() => ({
  appPath: null, // set per launch
  app: { getName: () => 'my-app', getAppPath: () => mocks.appPath, quit: vi.fn() },
  dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
  clipboard: { writeText: vi.fn() },
  spawn: vi.fn(),
  execFile: vi.fn(),
  latestVersion: vi.fn(),
}))
vi.mock('electron', () => ({ app: mocks.app, dialog: mocks.dialog, clipboard: mocks.clipboard }))
vi.mock('latest-version', () => ({ default: mocks.latestVersion }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile }))

import { EventEmitter } from 'node:events'
import { join } from 'node:path'

const INSTALLER_PATH = join(import.meta.dirname, '../src/installer.js')
const PKG = { name: 'my-app', version: '1.10.1', bin: { 'my-app': 'bin/my-app.mjs' } }
const DIRS = { 'npm-global': '/npm/node_modules/my-app', 'npx-temp': '/home/u/.npm/_npx/ab12/node_modules/my-app', 'npm-start': '/src/my-app' }

// A fresh app launch, with its own updater
async function launch(mode, options) {
  mocks.appPath = DIRS[mode] ?? DIRS['npm-start']
  const { NpmUpdater } = await import('../src/NpmUpdater.js')
  return new NpmUpdater(PKG, { dev: mode === 'npm-dev', ...options })
}

async function launchAndInstall(mode, options) {
  const updater = await launch(mode, options)
  await updater.check()
  await updater.install()
}

// The spawned command line, from `node` on (@windows it sits behind `cmd /c start <title>`)
function spawnedArgv() {
  const [command, args] = mocks.spawn.mock.calls[0]
  return [command, ...args]
}

function publish(version, { ok = true } = {}) {
  if (ok) mocks.latestVersion.mockResolvedValue(version)
  else mocks.latestVersion.mockRejectedValue(new Error('Request failed with status code 503'))
  return mocks.latestVersion
}

let installer // the spawned installer process; each test decides whether it emits 'spawn' or 'error'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.execFile.mockReset()
  mocks.spawn.mockImplementation(() => installer = new EventEmitter())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('new NpmUpdater', () => {
  it("throws without the app's package.json, as it couldn't tell what to check", async () => {
    const { NpmUpdater } = await import('../src/NpmUpdater.js')
    expect(() => new NpmUpdater()).toThrow(/package\.json/)
  })

  it.each(['npm-global', 'npx-temp', 'npm-start', 'npm-dev'])('tells a %s launch apart', async mode => {
    expect((await launch(mode)).launchMode).toBe(mode)
  })
})

describe('check', () => {
  it.each(['npm-global', 'npm-dev'])('reports a newer published version to a %s launch', async mode => {
    publish('1.11.0')
    const updater = await launch(mode)
    expect(await updater.check()).toEqual({ type: 'update', current: '1.10.1', latest: '1.11.0', spec: 'my-app@1.11.0' })
  })

  it.each(['1.10.1', '1.9.5'])('stays quiet when the registry has %s', async version => {
    publish(version)
    const updater = await launch('npm-global')
    expect(await updater.check()).toBeNull()
  })

  it('asks the registry for the app\'s own package', async () => {
    const registry = publish('1.11.0')
    const updater = await launch('npm-global')
    await updater.check()
    expect(registry).toHaveBeenCalledWith('my-app')
  })

  it('never asks the registry from a local checkout', async () => {
    const registry = publish('9.9.9')
    const updater = await launch('npm-start')
    expect(await updater.check()).toBeNull()
    expect(registry).not.toHaveBeenCalled()
  })

  it('offers an npx run the global install, even on the latest version', async () => {
    publish('1.10.1')
    const updater = await launch('npx-temp')
    expect(await updater.check()).toEqual({ type: 'install', current: '1.10.1', latest: '1.10.1', spec: 'my-app@1.10.1' })
  })

  it('stays quiet when the registry fails', async () => {
    publish('9.9.9', { ok: false })
    const updater = await launch('npm-global')
    expect(await updater.check()).toBeNull()
  })

  it('asks the registry once per launch', async () => {
    const registry = publish('1.11.0')
    const updater = await launch('npm-global')
    await updater.check()
    await updater.check()
    expect(registry).toHaveBeenCalledTimes(1)
  })
})

describe('check({ fresh: true })', () => {
  it('asks npm again', async () => {
    publish('1.11.0')
    const updater = await launch('npm-dev')
    await updater.check()
    publish('1.12.0')
    expect(await updater.check({ fresh: true })).toEqual({ type: 'update', current: '1.10.1', latest: '1.12.0', spec: 'my-app@1.12.0' })
    expect(mocks.latestVersion).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous answer when the fresh check fails', async () => {
    publish('1.11.0')
    const updater = await launch('npm-global')
    await updater.check()
    publish('9.9.9', { ok: false })
    expect(await updater.check({ fresh: true })).toMatchObject({ latest: '1.11.0' })
  })

  it('lets a later check succeed after a failed one', async () => {
    publish('9.9.9', { ok: false })
    const updater = await launch('npm-global')
    expect(await updater.check()).toBeNull()
    publish('1.11.0')
    expect(await updater.check({ fresh: true })).toMatchObject({ latest: '1.11.0' })
  })

  it('has install() install what the latest check found', async () => {
    publish('1.11.0')
    const updater = await launch('npm-global')
    await updater.check()
    publish('1.12.0')
    await updater.check({ fresh: true })
    await updater.install()
    expect(spawnedArgv()).toContain('my-app@1.12.0')
  })
})

describe('a git source', () => {
  const GIT = { source: 'github:me/my-app' }
  // `git ls-remote --tags --refs`: version tags, out of order, and tags that aren't versions
  const TAGS = ['v1.10.1', 'v1.11.0-build.10', 'v1.11.0-build.9', 'nightly', 'v2-beta']
    .map((tag, i) => `${String(i).padStart(40, '0')}\trefs/tags/${tag}`).join('\n')
  const failure = stderr => Object.assign(new Error('Command failed: git ls-remote'), { stderr })
  const SIGN_IN = [failure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), failure('git@github.com: Permission denied (publickey).')]
  const lsRemote = (...results) => results.forEach(r => mocks.execFile.mockImplementationOnce((cmd, args, opts, done) => r instanceof Error ? done(r) : done(null, { stdout: r })))
  const checkGit = async () => (await launch('npm-global', GIT)).check()

  it('reports the highest version tag, to install exactly that tag', async () => {
    lsRemote(TAGS)
    const updater = await launch('npm-global', GIT)
    expect(await updater.check()).toEqual({ type: 'update', current: '1.10.1', latest: '1.11.0-build.10', spec: 'github:me/my-app#v1.11.0-build.10' })
    const [command, args, { env }] = mocks.execFile.mock.calls[0]
    expect([command, ...args]).toEqual(['git', 'ls-remote', '--tags', '--refs', 'https://github.com/me/my-app.git'])
    expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: expect.stringContaining('-o BatchMode=yes'), LC_ALL: 'C' }) // never prompts, errors in English
  })

  it('stays quiet when no tag is newer', async () => {
    lsRemote(`${'0'.repeat(40)}\trefs/tags/v1.10.1`)
    expect(await checkGit()).toBeNull()
  })

  it('falls back to ssh when https fails, as npm does', async () => {
    lsRemote(failure('fatal: unable to access'), TAGS)
    expect(await checkGit()).toMatchObject({ latest: '1.11.0-build.10' })
    expect(mocks.execFile.mock.calls[1][1]).toContain('ssh://git@github.com/me/my-app.git')
  })

  it('keeps the previous answer when ls-remote fails', async () => {
    lsRemote(TAGS, failure('fatal: unable to access'), failure('ssh: connect to host github.com port 22: timed out'))
    const updater = await launch('npm-global', GIT)
    await updater.check()
    expect(await updater.check({ fresh: true })).toMatchObject({ latest: '1.11.0-build.10' })
  })

  it('reports a sign-in problem, with a command that fixes it', async () => {
    lsRemote(...SIGN_IN)
    expect(await checkGit()).toEqual({
      type:    'problem',
      problem: 'sign-in',
      message: "git couldn't sign in to github.com",
      fix:     'git ls-remote https://github.com/me/my-app.git',
    })
  })

  it('stays quiet when only some URLs were refused, as the others may just be down', async () => {
    lsRemote(failure('fatal: unable to access: Could not resolve host'), SIGN_IN[1])
    expect(await checkGit()).toBeNull()
  })

  it('stays quiet about a repo without version tags, without trying ssh', async () => {
    lsRemote('')
    expect(await checkGit()).toBeNull()
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
  })

  it('keeps an update already found when signing in fails later, as its install can still sign in', async () => {
    lsRemote(TAGS, ...SIGN_IN)
    const updater = await launch('npm-global', GIT)
    await updater.check()
    expect(await updater.check({ fresh: true })).toMatchObject({ latest: '1.11.0-build.10' })
  })

  it('reports a missing git', async () => {
    lsRemote(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }))
    expect(await checkGit()).toMatchObject({ problem: 'git-missing' })
  })

  it('has the installer install the tag it found', async () => {
    lsRemote(TAGS)
    await launchAndInstall('npm-global', GIT)
    expect(spawnedArgv().slice(-4)).toEqual(['my-app', 'github:me/my-app#v1.11.0-build.10', '--reopen', 'bin/my-app.mjs'])
  })

  it('shows a problem in the prompt once per launch, offering to copy the fix', async () => {
    lsRemote(...SIGN_IN, ...SIGN_IN)
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 0 }) // Copy
    const updater = await launch('npm-global', GIT)
    await updater.check()
    await updater.prompt()
    await updater.check({ fresh: true })
    await updater.prompt()
    expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(mocks.clipboard.writeText).toHaveBeenCalledWith('git ls-remote https://github.com/me/my-app.git')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})

describe('install', () => {
  it('installs the last answer at once, not waiting on a re-check still running', async () => {
    publish('1.11.0')
    const updater = await launch('npm-global')
    await updater.check()
    mocks.latestVersion.mockReturnValue(new Promise(() => {})) // a re-check that never answers
    updater.check({ fresh: true })
    await updater.install()
    expect(spawnedArgv()).toContain('my-app@1.11.0')
  })

  it('hands off to the installer with everything it needs, then quits once it runs', async () => {
    publish('1.11.0')
    await launchAndInstall('npm-global')
    expect(spawnedArgv().slice(-7)).toEqual([
      'node',
      INSTALLER_PATH,
      String(process.pid),
      'my-app',
      'my-app@1.11.0',
      '--reopen',
      'bin/my-app.mjs',
    ])
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ detached: true })
    expect(mocks.app.quit).not.toHaveBeenCalled()
    installer.emit('spawn')
    expect(mocks.app.quit).toHaveBeenCalled()
  })

  it('stays open and says why when node cannot be started', async () => {
    publish('1.11.0')
    await launchAndInstall('npm-global')
    installer.emit('error', new Error('spawn node ENOENT'))
    expect(mocks.app.quit).not.toHaveBeenCalled()
    expect(mocks.dialog.showErrorBox).toHaveBeenCalled()
  })

  it('runs the update from dev too, without asking to reopen a window whose dev server is gone', async () => {
    publish('1.11.0')
    await launchAndInstall('npm-dev')
    expect(spawnedArgv().slice(-3)).toEqual([String(process.pid), 'my-app', 'my-app@1.11.0'])
  })

  it('installs the global version from an npx run', async () => {
    publish('1.10.1')
    await launchAndInstall('npx-temp')
    expect(spawnedArgv().slice(-4)).toEqual(['my-app', 'my-app@1.10.1', '--reopen', 'bin/my-app.mjs'])
  })

  it('installs the spec it is given', async () => {
    publish('1.11.0')
    const updater = await launch('npm-global')
    const update = await updater.check()
    publish('1.12.0')
    await updater.check({ fresh: true })
    await updater.install(update.spec)
    expect(spawnedArgv()).toContain('my-app@1.11.0')
  })

  it('does nothing before a check', async () => {
    publish('1.11.0')
    const updater = await launch('npm-global')
    await updater.install()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does nothing without a newer version', async () => {
    publish('1.10.1')
    await launchAndInstall('npm-global')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})

describe('prompt', () => {
  const answer = button => mocks.dialog.showMessageBox.mockImplementation(async ({ buttons }) => ({ response: buttons.indexOf(button) }))

  it('installs the new version when the user agrees', async () => {
    publish('1.11.0')
    answer('Update now')
    await (await launch('npm-global')).prompt()
    expect(mocks.dialog.showMessageBox.mock.calls[0][0].message).toBe('my-app 1.11.0 is available')
    expect(spawnedArgv()).toContain('my-app@1.11.0')
  })

  it('leaves the app alone when the user says later', async () => {
    publish('1.11.0')
    answer('Later')
    await (await launch('npm-global')).prompt()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('stays silent without an update', async () => {
    publish('1.10.1')
    await (await launch('npm-global')).prompt()
    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('reuses the launch\'s check, so a checkout can try it after a dev check', async () => {
    publish('1.11.0')
    answer('Later')
    const updater = await launch('npm-dev')
    await updater.check()
    await updater.prompt()
    expect(mocks.dialog.showMessageBox).toHaveBeenCalled()
  })

  it('asks an npx run to install only when opted in', async () => {
    publish('1.10.1')
    answer('Install')
    await (await launch('npx-temp')).prompt()
    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled()
    await (await launch('npx-temp')).prompt({ offerInstall: true })
    expect(mocks.dialog.showMessageBox.mock.calls[0][0].message).toBe('Install my-app?')
    expect(spawnedArgv()).toContain('my-app@1.10.1')
  })
})
