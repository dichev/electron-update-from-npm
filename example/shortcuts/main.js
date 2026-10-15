// Writes real "Shortcuts Example (local)" shortcuts with icon.png: Start Menu + Desktop on Windows, ~/Applications on macOS. Delete them by hand.
// For a clean first run, also delete electron-update-from-npm.json and shortcut-icons/ in the userData folder this window shows.
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { NpmUpdater } from '../../src/index.js'
import pkg from './package.json' with { type: 'json' }

const updater = new NpmUpdater(pkg)
updater.createShortcuts({ name: 'Shortcuts Example', icon: 'icon.png' })

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 640, height: 200, icon: join(import.meta.dirname, 'icon.png') })
  win.loadURL(`data:text/html,${encodeURIComponent(`<body style="font: 14px system-ui; padding: 0 16px">
    <p>Launch mode: <b>${updater.launchMode}</b></p>
    <p>userData: <code>${app.getPath('userData')}</code></p>`)}`)
})
