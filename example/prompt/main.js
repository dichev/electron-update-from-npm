// Shows the update prompt from a checkout. This package.json poses as electron-update-from-npm 0.0.0, so any published version or tag counts as newer.
// "Update now" really runs `npm i -g`, so `npm uninstall -g` the package afterwards. For a git source: npm run example:prompt -- github:owner/repo
import { app } from 'electron'
import { NpmUpdater } from '../../src/index.js'
import pkg from './package.json' with { type: 'json' }

const updater = new NpmUpdater(pkg, { dev: true, source: process.argv[2] })

app.whenReady().then(async () => {
  if (!await updater.check()) console.log('No update found: are you online?')
  await updater.prompt()
  app.quit()
})
