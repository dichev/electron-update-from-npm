import type { LaunchMode } from './launch-mode.js'
export { LAUNCH_MODES, type LaunchMode } from './launch-mode.js'

/** Your app's package.json: what to check on npm, the running version, and the `bin` that reopens the app after an update. */
export interface AppPackage {
  name: string
  version: string
  bin?: string | Record<string, string>
}

export interface NpmUpdaterOptions {
  /** Check a git repo's `v<version>` tags instead of npm for `pkg.name`, e.g. `github:owner/repo`, for an app installed from git. Default: npm. */
  source?: string
  /** A dev-server run of a repo checkout: checks for updates anyway, to debug the flow (installing replaces your global install, and doesn't reopen), and writes no shortcuts. Default: false. */
  dev?: boolean
}

/** A newer version than the running one, for an `npm i -g` install. */
export interface Update {
  type: 'update'
  /** The running version. */
  current: string
  /** The latest version, on npm or in the git source's tags. */
  latest: string
  /** What `install()` passes to `npm i -g`: `name@version`, or `github:owner/repo#v<version>` for a git source. */
  spec: string
}

/** Running under npx: offer the global install. Made without a lookup, so it shows offline too. */
export interface InstallOffer {
  type: 'install'
  /** What `install()` passes to `npm i -g`: the package name, so npm picks the latest. Absent for a git source, where `install()` looks up the latest tag. */
  spec?: string
}

/** A failed check only the user can fix, reported instead of retried quietly. */
export interface UpdateProblem {
  type: 'problem'
  problem: 'sign-in' | 'git-missing'
  message: string
  /** A command to run once in a terminal (sign-in), or where to get git. */
  fix: string
}

export interface ShortcutOptions {
  /** Reverse-DNS app id, for the @windows taskbar and the @macOS bundle; a repo checkout gets `.local` appended. Default: `com.electron.<package name>`. */
  appId?: string
  /** Shortcut name; a repo checkout gets ` (local)` appended. Default: `app.getName()`. */
  name?: string
  /** @windows The shortcut's tooltip. */
  description?: string
}

export interface PromptOptions {
  /** Also ask npx runs to install the app globally; off by default, as they'd be asked on every launch. Default: false. */
  offerInstall?: boolean
}

export class NpmUpdater {
  constructor(pkg: AppPackage, options?: NpmUpdaterOptions)
  /** How the app was launched: `npm-global`, `npx-temp`, `npm-start` (a repo checkout), or `npm-dev` (with `dev`). */
  readonly launchMode: LaunchMode
  /** Writes @windows Start Menu + Desktop shortcuts and @macOS an ~/Applications launcher, for an `npm i -g` install. Call before any window is created. Never throws: a failed write is logged and retried on the next launch. */
  createShortcuts(options?: ShortcutOptions): void
  /** Asks for a newer version; calls made while a check is running share it. Under npx, resolves to an `InstallOffer` at once. Resolves to null when up to date, from a repo checkout, or on a passing failure (keeping an update already found). */
  check(): Promise<Update | InstallOffer | UpdateProblem | null>
  /** Installs the given `update.spec`, or what the latest check found: closes the app, runs `npm i -g`, then reopens it. Without a spec, an npx run installs the latest release; anything else does nothing. */
  install(spec?: string): Promise<void>
  /** Checks, and if there's an update asks "Update now / Later" in a native dialog, installing on yes (npx runs with `offerInstall`: "Install / Not now"); a problem is shown once per launch. Call after the app is ready. */
  prompt(options?: PromptOptions): Promise<void>
}
