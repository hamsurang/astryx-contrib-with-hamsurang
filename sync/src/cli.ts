import { runSync } from './sync.js'

const dryRun = process.argv.includes('--dry-run')

runSync({ dryRun })
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
