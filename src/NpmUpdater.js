// Tells an `npm i -g` install of an Electron app about a newer release (on npm, or tagged in its git repo) and installs
// it; an npx run is offered the global install instead. A checkout only checks in `dev`, to debug the flow.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, clipboard, dialog } from 'electron'
import latestVersion from 'latest-version'
import semver from 'semver'
import { LAUNCH_MODES, launchMode } from './launch-mode.js'
import { writeShortcuts } from './shortcuts.js'

const INSTALLER_PATH = join(import.meta.dirname, 'installer.js')

export class NpmUpdater {
  #pkg
  #mode
  #source
  #checked      = null
  #answer       = null // the last settled check, so an install never waits on a re-check
  #problemShown = false

  constructor(pkg, { source, dev = false } = {}) {
    if (!pkg?.name || !pkg.version) throw new TypeError("new NpmUpdater(pkg): pkg is your app's package.json, with its name and version")
    this.#pkg = pkg
    this.#mode = launchMode(app.getAppPath(), { dev })
    this.#source = source
  }

  get launchMode() {
    return this.#mode
  }

  // Call before any window is created, so the window picks up the app id
  createShortcuts(options) {
    writeShortcuts(this.#mode, this.#pkg.name, options)
  }

  // Shares the last answer, so a renderer reload doesn't ask again; `fresh` asks again for an app left open
  check({ fresh = false } = {}) {
    if (this.#checked && !fresh) return this.#checked
    return this.#checked = this.#fetchNewer()
      .catch(err => {
        if (!err.problem) console.warn('[electron-update-from-npm] check failed:', err.message)
        // Offline for a moment, or signed out since, shouldn't drop an update already found: its install can still sign in
        if (this.#answer?.spec || !err.problem) return this.#answer
        return { type: 'problem', problem: err.problem, message: err.message, fix: err.fix }
      })
      .then(result => this.#answer = result)
  }

  // Installs the given spec, or what the latest check found
  async install(spec) {
    spec ??= (this.#answer ?? await this.#checked)?.spec
    if (!spec) return
    const bin = binPath(this.#pkg)
    // Dev isn't reopened: its renderer usually lives on a dev server, which dies with the app
    const reopen = this.#mode !== LAUNCH_MODES.NPM_DEV && bin ? ['--reopen', bin] : []
    const args = [INSTALLER_PATH, process.pid, this.#pkg.name, spec, ...reopen].map(String)
    // The system node, not our electron.exe: npm can't replace the package while anything runs inside it.
    // @windows `start` opens a console showing the progress; its title needs a space, or node leaves it unquoted and `start` runs it
    const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', `Updating ${app.getName()}`, 'node', ...args]] : ['node', args]
    spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'inherit', 'inherit'], cwd: homedir() })
      .once('spawn', () => app.quit())
      .once('error', err => dialog.showErrorBox('Update failed', `Could not start node: ${err.message}`))
  }

  // A native dialog for apps without an update UI of their own. npx runs are asked only with `offerInstall`, as they'd be asked every launch
  async prompt({ offerInstall = false, ...checkOptions } = {}) {
    const update = await this.check(checkOptions)
    if (update?.type === 'problem') return this.#promptProblem(update)
    if (!update || (update.type === 'install' && !offerInstall)) return
    const { response } = await dialog.showMessageBox(update.type === 'install' ? {
      message: `Install ${app.getName()}?`,
      detail:  `It's running from npx's temporary copy. Installing it keeps it around (npm i -g ${update.spec}).`,
      buttons: ['Install', 'Not now'],
    } : {
      message: `${app.getName()} ${update.latest} is available`,
      detail:  `You have ${update.current}. Updating restarts the app.`,
      buttons: ['Update now', 'Later'],
    })
    if (response === 0) await this.install(update.spec)
  }

  // Once per launch: asking on every check would nag
  async #promptProblem({ problem, message, fix }) {
    if (this.#problemShown) return
    this.#problemShown = true
    const { response } = await dialog.showMessageBox({
      message: `Can't check for updates to ${app.getName()}`,
      detail:  `${message}. ${problem === 'sign-in' ? 'Run this once in a terminal to sign in' : 'Install it'}, then restart the app:\n\n${fix}`,
      buttons: ['Copy', 'Later'],
    })
    if (response === 0) clipboard.writeText(fix)
  }

  async #fetchNewer() {
    if (this.#mode === LAUNCH_MODES.NPM_START) return null
    const { name, version: current } = this.#pkg
    const { latest, spec } = this.#source ? await (await import('./git.js')).latestTag(this.#source) : await latestOnNpm(name) // git only loads for a git source
    // npx isn't updated in place: it's always offered the global install instead
    if (this.#mode === LAUNCH_MODES.NPX_TEMP) return { type: 'install', current, latest, spec }
    return semver.gt(latest, current) ? { type: 'update', current, latest, spec } : null
  }
}

// package.json's `bin` is a path, or a map of commands to paths
function binPath({ name, bin }) {
  return typeof bin === 'string' ? bin : bin?.[name] ?? Object.values(bin ?? {})[0]
}

async function latestOnNpm(name) {
  const latest = await latestVersion(name)
  return { latest, spec: `${name}@${latest}` }
}
