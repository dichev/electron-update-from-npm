import type { LaunchMode } from './launch-mode.js'
export { LAUNCH_MODES, launchMode, type LaunchMode } from './launch-mode.js'

export interface Update {
  /** The app's npm package name. */
  name: string
  /** The running version. */
  current: string
  /** The latest version, on npm or in the git source's tags. */
  latest: string
  /** How the app was launched: `npx-temp` always gets a result, to offer a global install. */
  mode: Exclude<LaunchMode, 'npm-start'>
  /** What `installUpdate()` passes to `npm i -g`: `name@version`, or `github:owner/repo#v<version>` for a git source. */
  spec: string
}

/** A failed check only the user can fix, reported instead of retried quietly. */
export interface UpdateProblem {
  problem: 'sign-in' | 'git-missing'
  message: string
  /** A command to run once in a terminal (sign-in), or where to get git. */
  fix: string
}

export interface CheckOptions {
  /** Check from a repo checkout too; the install then updates the global install and doesn't reopen. Default: false. */
  dev?: boolean
  /** Check again instead of sharing the last answer, e.g. on a timer for an app left open; a failed one keeps the last answer. Default: false. */
  fresh?: boolean
  /** Check a git repo's `v<version>` tags instead of npm, e.g. `github:owner/repo`, for an app installed from git. Default: npm. */
  source?: string
}

/** Asks for a newer version, sharing the answer until a `fresh` check. Resolves to null when up to date, from a repo checkout, or on a passing failure. */
export function checkForUpdate(options?: CheckOptions): Promise<Update | UpdateProblem | null>

export interface ShortcutOptions {
  /** Reverse-DNS app id, for the @windows taskbar and the @macOS bundle; a repo checkout gets `.local` appended. Default: `com.electron.<package name>`. */
  appId?: string
  /** Shortcut name; a repo checkout gets ` (local)` appended. Default: `app.getName()`. */
  name?: string
  /** @windows The shortcut's tooltip. */
  description?: string
  /** A repo checkout in development: sets the app id but writes no shortcuts. Default: false. */
  dev?: boolean
}

/** Writes @windows Start Menu + Desktop shortcuts and @macOS an ~/Applications launcher, for an `npm i -g` install. Call before any window is created. */
export function createShortcuts(options?: ShortcutOptions): void

/** Installs what the latest check found: closes the app, runs `npm i -g`, then reopens it. Does nothing without an update. */
export function installUpdate(): Promise<void>

export interface PromptOptions extends CheckOptions {
  /** Also ask npx runs to install the app globally; off by default, as they'd be asked on every launch. Default: false. */
  npx?: boolean
}

/** Checks, and if there's an update asks "Update now / Later" in a native dialog, installing on yes; a problem is shown once per launch. Call after the app is ready. */
export function promptForUpdate(options?: PromptOptions): Promise<void>
