import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { fetchPullRequests } from './github.js'
import { NotionClient } from './notion.js'
import { plan } from './plan.js'
import type { Action } from './types.js'

function describe(action: Action): string {
  return action.kind === 'create'
    ? `  생성  ${action.status.padEnd(22)} ${action.title}`
    : `  갱신  ${(action.status ?? '(상태 유지)').padEnd(22)} ${action.key}${action.icon ? ` → ${action.icon}` : ''}`
}

export async function runSync(options: { dryRun: boolean }): Promise<number> {
  const notionToken = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_DATABASE_ID
  const githubToken = process.env.GITHUB_TOKEN

  if (!notionToken) throw new Error('NOTION_TOKEN 이 없다')
  if (!databaseId) throw new Error('NOTION_DATABASE_ID 가 없다')
  if (!githubToken) throw new Error('GITHUB_TOKEN 이 없다')

  const config = loadConfig(fileURLToPath(new URL('..', import.meta.url)), fileURLToPath(new URL('../..', import.meta.url)))
  const notion = new NotionClient(notionToken, databaseId, config)

  await notion.verifySchema()

  // 수집은 전부-아니면-전무다. 여기서 예외가 나면 아무것도 쓰지 않고 끝난다.
  const [prs, cards] = await Promise.all([
    fetchPullRequests(config, githubToken),
    notion.fetchCards(),
  ])

  const { actions, warnings } = plan(prs, cards, config)

  console.log(`PR ${prs.length}건, 카드 ${cards.length}장 → 작업 ${actions.length}건`)
  for (const warning of warnings) console.warn(`  경고  ${warning}`)
  for (const action of actions) console.log(describe(action))

  if (options.dryRun) {
    console.log('\n--dry-run 이므로 아무것도 쓰지 않았다.')
    return 0
  }

  // 반영은 카드 단위로 독립이다. 하나가 실패해도 나머지를 계속 진행한다.
  const failures: string[] = []
  for (const action of actions) {
    try {
      await notion.apply(action)
    } catch (error) {
      failures.push(`${action.key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length}건 실패:`)
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }

  console.log('\n완료.')
  return 0
}
