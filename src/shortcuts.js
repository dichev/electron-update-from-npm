// Launcher shortcuts for an `npm i -g` install: @windows Start Menu + Desktop .lnk files, @macOS an ~/Applications bundle.
// Written from the app rather than a postinstall: npm runs no uninstall hooks anyway, and plain node has no shortcut API.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { app, nativeImage, shell } from 'electron'
import { LAUNCH_MODES } from './launch-mode.js'
import { pngAt, toIco, toIcns } from './lib/icons.js'

export function writeShortcuts(mode, packageName, { appId = `com.electron.${packageName}`, name = app.getName(), description = '', icon } = {}) {
  // An installed package and a repo checkout get their own shortcuts, so both stay launchable
  const shortcut = mode === LAUNCH_MODES.NPM_START || mode === LAUNCH_MODES.NPM_DEV ? { id: `${appId}.local`, name: `${name} (local)`, description } : { id: appId, name, description }
  if (process.platform === 'win32') app.setAppUserModelId(shortcut.id) // shared by the process and its shortcuts, so a pinned taskbar icon groups with the window
  if (mode === LAUNCH_MODES.NPX_TEMP || mode === LAUNCH_MODES.NPM_DEV) return // an npx cache dir is deleted later, and dev shouldn't touch the user's shortcuts

  const os = process.platform === 'win32' ? new WindowsLinks(shortcut) : process.platform === 'darwin' ? new MacBundle(shortcut) : null
  if (!os) return

  // A new install or update (npm recreates the package dir, so its birth time identifies it) writes them all; after that, only a change to
  // what they contain (a moved checkout, new options or logo, a new PATH on macOS) re-points the ones still there, so a deleted one stays deleted.
  const iconPath  = icon && resolve(app.getAppPath(), icon)
  const install   = fs.statSync(app.getAppPath()).birthtimeMs
  const content   = JSON.stringify([app.getAppPath(), process.execPath, shortcut, iconPath, iconPath && fs.statSync(iconPath, { throwIfNoEntry: false })?.mtimeMs, process.platform === 'darwin' && process.env.PATH])
  const stateFile = join(app.getPath('userData'), 'electron-update-from-npm.json')
  const state     = readJson(stateFile)
  const due       = os.paths().filter(path => state[path]?.install !== install || (state[path].content !== content && fs.existsSync(path)))
  if (!due.length) return

  shortcut.icon = iconPath && loadIcon(iconPath)
  let failed
  for (const path of due) {
    try { os.write(path); state[path] = { install, content } } catch (err) { failed ??= err } // a failed one is retried on the next launch
  }
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state))
  if (failed) throw failed
}

function readJson(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')) } catch { return {} }
}

// Falls back to Electron's icon: dev runs write no shortcuts, so a bad path would otherwise only show up as missing ones
function loadIcon(path) {
  const image = nativeImage.createFromPath(path)
  if (!image.isEmpty()) return image
  console.warn(`[electron-update-from-npm] cannot read icon ${path}, using Electron's`)
  return null
}


class WindowsLinks { // @windows
  #ico
  constructor(shortcut) { this.shortcut = shortcut }

  paths() {
    return [join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs'), app.getPath('desktop')].map(dir => join(dir, `${this.shortcut.name}.lnk`))
  }

  write(path) {
    const written = shell.writeShortcutLink(path, 'create', { // 'create' overwrites an existing one
      target:         process.execPath,
      args:           `"${app.getAppPath()}"`,
      description:    this.shortcut.description,
      icon:           this.shortcut.icon ? this.#ico ??= this.#writeIco() : process.execPath,
      iconIndex:      0,
      appUserModelId: this.shortcut.id,
    })
    if (!written) throw new Error(`cannot write ${path}`)
  }

  // Kept in userData: the package dir is replaced on every update, and the shortcuts outlive it.
  // Named by content, as Explorer caches icons by path: a new logo needs a new file to show.
  #writeIco() {
    const ico  = toIco(pngAt(this.shortcut.icon, 256))
    const dir  = join(app.getPath('userData'), 'shortcut-icons', this.shortcut.id)
    const name = `${createHash('sha1').update(ico).digest('hex').slice(0, 8)}.ico`
    fs.mkdirSync(dir, { recursive: true })
    for (const old of fs.readdirSync(dir)) if (old !== name) fs.rmSync(join(dir, old))
    fs.writeFileSync(join(dir, name), ico)
    return join(dir, name)
  }
}


// A stub bundle handing off to npm's Electron.app, not a renamed copy of it: editing Electron's plist breaks its signature.
// Finder launches get a bare PATH, so the stub passes on this launch's (the update needs npm and node, the app maybe more).
class MacBundle { // @macOS
  constructor(shortcut) { this.shortcut = shortcut }

  paths() { return [join(app.getPath('home'), 'Applications', `${this.shortcut.name}.app`)] }

  write(path) {
    const electronApp = join(process.execPath, '../../..')
    const quote = s => `'${s.replaceAll("'", `'\\''`)}'`
    fs.mkdirSync(join(path, 'Contents/MacOS'), { recursive: true })
    fs.mkdirSync(join(path, 'Contents/Resources'), { recursive: true })
    const icns = join(path, 'Contents/Resources/icon.icns')
    if (this.shortcut.icon) fs.writeFileSync(icns, toIcns({
      ic08: pngAt(this.shortcut.icon, 256),
      ic09: pngAt(this.shortcut.icon, 512)
    }))
    else fs.copyFileSync(join(electronApp, 'Contents/Resources/electron.icns'), icns)
    fs.writeFileSync(join(path, 'Contents/MacOS/launch'), [
      '#!/bin/sh',
      `exec open -n ${quote(electronApp)} --env ${quote(`PATH=${process.env.PATH}`)} --args ${quote(app.getAppPath())}`,
      '',
    ].join('\n'), { mode: 0o755 })
    // LSUIElement keeps the stub itself out of the Dock, next to Electron's icon
    fs.writeFileSync(join(path, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${this.shortcut.name}</string>
  <key>CFBundleIdentifier</key><string>${this.shortcut.id}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`)
  }
}
