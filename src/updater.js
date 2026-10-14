// Tells an `npm i -g` install of an Electron app about a newer release (on npm, or tagged in its git repo) and installs
// it; an npx run is offered the global install instead. A checkout only checks in `dev`, to debug the flow.
import { exec, spawn } from 'node:child_process'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, clipboard, dialog } from 'electron'
import semver from 'semver'
import { LAUNCH_MODES, launchMode } from './launch-mode.js'
import { writeShortcuts } from './shortcuts.js'

const UPDATE_SCRIPT = join(import.meta.dirname, '../bin/update.js')

export class NpmUpdater {
  #pkg
  #mode
  #source
  #checking     = null
  #installing   = null
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

  // Call before any window is created, so the window picks up the app id.
  // Never throws: a missing launcher isn't worth failing the app's startup over, and the next launch retries.
  createShortcuts(options) {
    try {
      writeShortcuts(this.#mode, this.#pkg.name, options)
    } catch (err) {
      console.warn('[electron-update-from-npm] shortcuts failed:', err.message)
    }
  }

  // Calls made while a check is running share it
  check() {
    return this.#checking ??= this.#fetchNewer()
      .catch(err => {
        if (!err.problem) console.warn('[electron-update-from-npm] check failed:', err.message)
        // Offline for a moment, or signed out since, shouldn't drop an update already found: its install can still sign in
        if (this.#answer?.spec || !err.problem) return this.#answer
        return { type: 'problem', problem: err.problem, message: err.message, fix: err.fix }
      })
      .then(result => this.#answer = result)
      .finally(() => this.#checking = null)
  }

  // Installs the given spec, or what the latest check found. Calls made while an install is starting share it
  install(spec) {
    return this.#installing ??= this.#install(spec).finally(() => this.#installing = null)
  }

  async #install(spec) {
    spec ??= (this.#answer ?? await this.#checking)?.spec
    if (!spec && this.#mode === LAUNCH_MODES.NPX_TEMP) {
      try { ({ spec } = await this.#latest()) }
      catch (err) {
        if (err.problem) return this.#showProblem(`Can't install ${app.getName()}`, err)
        return dialog.showErrorBox('Install failed', `Could not find the latest version: ${err.message}`)
      }
    }
    if (!spec) return
    const bin = binPath(this.#pkg)
    // Dev isn't reopened: its renderer usually lives on a dev server, which dies with the app.
    // A failed install reopens this copy: under npx there's no global one to fall back on
    const reopen = this.#mode !== LAUNCH_MODES.NPM_DEV && bin ? ['--reopen', bin, '--current', app.getAppPath()] : []
    const args = [UPDATE_SCRIPT, process.pid, this.#pkg.name, spec, ...reopen].map(String)
    // The system node, not our electron.exe: npm can't replace the package while anything runs inside it.
    // @windows `start` opens a console showing the progress; its title needs a space, or node leaves it unquoted and `start` runs it
    const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', `Updating ${app.getName()}`, 'node', ...args]] : ['node', args]
    const updating = spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'inherit', 'inherit'], cwd: homedir() })
    try {
      await once(updating, 'spawn')
      app.quit()
    } catch (err) {
      dialog.showErrorBox('Update failed', `Could not start node: ${err.message}`)
    }
  }

  // A native dialog for apps without an update UI of their own. npx runs are asked only with `offerInstall`, as they'd be asked every launch
  async prompt({ offerInstall = false } = {}) {
    const update = await this.check()
    if (update?.type === 'problem') return this.#promptProblem(update)
    if (!update || (update.type === 'install' && !offerInstall)) return
    const { response } = await dialog.showMessageBox(update.type === 'install' ? {
      message: `Install ${app.getName()}?`,
      detail:  `It's running from npx's temporary copy. Installing it with npm i -g keeps it around.`,
      buttons: ['Install', 'Not now'],
    } : {
      message: `${app.getName()} ${update.latest} is available`,
      detail:  `You have ${update.current}. Updating restarts the app.`,
      buttons: ['Update now', 'Later'],
    })
    if (response === 0) await this.install(update.spec)
  }

  // Once per launch: asking on every check would nag
  async #promptProblem(problem) {
    if (this.#problemShown) return
    this.#problemShown = true
    await this.#showProblem(`Can't check for updates to ${app.getName()}`, problem)
  }

  async #showProblem(title, { problem, message, fix }) {
    const { response } = await dialog.showMessageBox({
      message: title,
      detail:  `${message}. ${problem === 'sign-in' ? 'Run this once in a terminal to sign in' : 'Install it'}, then restart the app:\n\n${fix}`,
      buttons: ['Copy', 'Later'],
    })
    if (response === 0) clipboard.writeText(fix)
  }

  async #fetchNewer() {
    if (this.#mode === LAUNCH_MODES.NPM_START) return null
    // No lookup: install() finds the latest release. A bare git spec would install the default branch instead of the latest tag
    if (this.#mode === LAUNCH_MODES.NPX_TEMP) return this.#source ? { type: 'install' } : { type: 'install', spec: this.#pkg.name }
    const current = this.#pkg.version
    const { latest, spec } = await this.#latest()
    return semver.gt(latest, current) ? { type: 'update', current, latest, spec } : null
  }

  // git only loads for a git source
  async #latest() {
    return this.#source ? (await import('./git-tags.js')).latestTag(this.#source) : latestOnNpm(this.#pkg.name)
  }
}

// package.json's `bin` is a path, or a map of commands to paths
function binPath({ name, bin }) {
  return typeof bin === 'string' ? bin : bin?.[name] ?? Object.values(bin ?? {})[0]
}

async function latestOnNpm(name) {
  // npm itself, so private registries and auth resolve as they will for the install
  const latest = (await promisify(exec)(`npm view ${name} version`, { timeout: 30_000, windowsHide: true })).stdout.trim()
  return { latest, spec: `${name}@${latest}` }
}
