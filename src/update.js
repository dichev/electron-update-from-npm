// Tells an `npm i -g` install of an Electron app about a newer release (on npm, or tagged in its git repo) and installs
// it; an npx run is offered the global install instead. A checkout only checks with `dev`, to debug the flow.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, clipboard, dialog } from 'electron'
import latestVersion from 'latest-version'
import semver from 'semver'
import { appPackage } from './app.js'
import { LAUNCH_MODES, launchMode } from './launch-mode.js'

const INSTALLER_PATH = join(import.meta.dirname, 'installer.js')

let checked      = null
let answer       = null // the last settled check, so an install never waits on a re-check
let launch       = null
let problemShown = false

// Shares the last answer, so a renderer reload doesn't ask again; `fresh` asks again for an app left open
export function checkForUpdate({ dev = false, fresh = false, source } = {}) {
  if (checked && !fresh) return checked
  launch ??= { mode: launchMode(app.getAppPath(), { dev }), source } // can't change while the app runs, so a fresh check needn't repeat them
  return checked = fetchNewer(launch)
    .catch(err => {
      if (!err.problem) console.warn('[electron-update-from-npm] check failed:', err.message)
      // Offline for a moment, or signed out since, shouldn't drop an update already found: its install can still sign in
      if (answer?.spec || !err.problem) return answer
      return { problem: err.problem, message: err.message, fix: err.fix }
    })
    .then(result => answer = result)
}

// Installs what the latest check found
export async function installUpdate() {
  const update = answer ?? await checked
  if (!update?.spec) return
  const { bin } = appPackage()
  // Dev isn't reopened: its renderer usually lives on a dev server, which dies with the app
  const reopen = update.mode !== LAUNCH_MODES.NPM_DEV && bin ? ['--reopen', bin] : []
  const args = [INSTALLER_PATH, process.pid, update.name, update.spec, ...reopen].map(String)
  // The system node, not our electron.exe: npm can't replace the package while anything runs inside it.
  // @windows `start` opens a console showing the progress; its title needs a space, or node leaves it unquoted and `start` runs it
  const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', `Updating ${app.getName()}`, 'node', ...args]] : ['node', args]
  spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'inherit', 'inherit'], cwd: homedir() })
    .once('spawn', () => app.quit())
    .once('error', err => dialog.showErrorBox('Update failed', `Could not start node: ${err.message}`))
}

// A native dialog for apps without an update UI of their own. npx runs are asked only with `npx: true`, as they'd be asked every launch
export async function promptForUpdate({ npx = false, ...checkOptions } = {}) {
  const update = await checkForUpdate(checkOptions)
  if (update?.problem) return promptProblem(update)
  if (!update || (update.mode === LAUNCH_MODES.NPX_TEMP && !npx)) return
  const { response } = await dialog.showMessageBox(update.mode === LAUNCH_MODES.NPX_TEMP ? {
    message: `Install ${app.getName()}?`,
    detail:  `It's running from npx's temporary copy. Installing it keeps it around (npm i -g ${update.spec}).`,
    buttons: ['Install', 'Not now'],
  } : {
    message: `${app.getName()} ${update.latest} is available`,
    detail:  `You have ${update.current}. Updating restarts the app.`,
    buttons: ['Update now', 'Later'],
  })
  if (response === 0) await installUpdate()
}

// Once per launch: asking on every check would nag
async function promptProblem({ problem, message, fix }) {
  if (problemShown) return
  problemShown = true
  const { response } = await dialog.showMessageBox({
    message: `Can't check for updates to ${app.getName()}`,
    detail:  `${message}. ${problem === 'sign-in' ? 'Run this once in a terminal to sign in' : 'Install it'}, then restart the app:\n\n${fix}`,
    buttons: ['Copy', 'Later'],
  })
  if (response === 0) clipboard.writeText(fix)
}

async function fetchNewer({ mode, source }) {
  if (mode === LAUNCH_MODES.NPM_START) return null
  const { name } = appPackage()
  const { latest, spec } = source ? await (await import('./git.js')).latestTag(source) : await latestOnNpm(name) // git only loads for a git source
  const current = app.getVersion()
  // npx isn't updated in place: it's always offered the global install instead
  return mode === LAUNCH_MODES.NPX_TEMP || semver.gt(latest, current) ? { name, current, latest, mode, spec } : null
}

async function latestOnNpm(name) {
  const latest = await latestVersion(name)
  return { latest, spec: `${name}@${latest}` }
}
