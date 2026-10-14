// Shows the update prompt from a checkout. This package.json poses as electron-update-from-npm 0.0.0, so its published version counts as newer.
// "Update now" really runs `npm i -g electron-update-from-npm` (a library, no command; `npm uninstall -g electron-update-from-npm` removes it)
import { app } from 'electron'
import { checkForUpdate, promptForUpdate } from '../src/index.js'

app.whenReady().then(async () => {
  if (!await checkForUpdate({ dev: true })) console.log('No update found: are you online?')
  await promptForUpdate({ dev: true })
  app.quit()
})
