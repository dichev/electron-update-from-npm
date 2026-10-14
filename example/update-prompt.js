// Shows the update prompt from a checkout. This package.json poses as electron-update-from-npm 0.0.0, so its published version counts as newer.
// "Update now" really runs `npm i -g electron-update-from-npm` (a library, no command; `npm uninstall -g electron-update-from-npm` removes it)
import { app } from 'electron'
import { NpmUpdater } from '../src/index.js'
import pkg from './package.json' with { type: 'json' }

const updater = new NpmUpdater(pkg, { dev: true })

app.whenReady().then(async () => {
  if (!await updater.check()) console.log('No update found: are you online?')
  await updater.prompt()
  app.quit()
})
