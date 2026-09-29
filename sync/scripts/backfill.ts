/**
 * 일회성 스크립트. 기존 카드에는 PR 링크가 비어 있고 PR 주소가 본문 북마크에만 있다.
 * 자동화가 카드를 인식하려면 동기화 키를 먼저 채워야 한다.
 *
 *   NOTION_TOKEN=... NOTION_DATABASE_ID=... GITHUB_TOKEN=... pnpm backfill --dry-run
 */
import { resolve } from 'node:path'
import { loadConfig } from '../src/config.js'
import { NotionClient } from '../src/notion.js'

const PR_URL = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/

const dryRun = process.argv.includes('--dry-run')
const notionToken = process.env.NOTION_TOKEN
const databaseId = process.env.NOTION_DATABASE_ID
const githubToken = process.env.GITHUB_TOKEN

if (!notionToken || !databaseId || !githubToken) {
  console.error('NOTION_TOKEN, NOTION_DATABASE_ID, GITHUB_TOKEN 이 모두 필요하다')
  process.exit(1)
}

const config = loadConfig(process.cwd(), resolve(process.cwd(), '..'))
const notion = new NotionClient(notionToken, databaseId, config)
await notion.verifySchema()

const cards = await notion.fetchCards()
const pending = cards.filter((card) => card.key === null)
console.log(`카드 ${cards.length}장 중 동기화 키가 빈 카드 ${pending.length}장`)

const unmatched: string[] = []

for (const card of pending) {
  const blockUrls = await notion.fetchBlockUrls(card.pageId)
  const urls = card.prUrl ? [card.prUrl, ...blockUrls] : blockUrls
  const match = urls.map((url) => PR_URL.exec(url)).find((m) => m !== null)

  if (!match) {
    unmatched.push(card.pageId)
    continue
  }

  const [, owner, repo, number] = match
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${githubToken}`, 'User-Agent': 'contrib-board-sync' },
  })

  if (!response.ok) {
    unmatched.push(`${card.pageId} (GitHub ${response.status})`)
    continue
  }

  // head.user.login 은 브랜치 소유자다. PR 작성자(user.login)가 아니라 이쪽을 써야
  // fork PR 과 upstream PR 이 같은 동기화 키를 갖는다.
  const pr = (await response.json()) as { html_url: string; head: { ref: string; user: { login: string } } }
  const key = `${pr.head.user.login}:${pr.head.ref}`

  console.log(`  ${card.pageId}  →  ${key}`)
  if (!dryRun) await notion.writeBackfill(card.pageId, pr.html_url, key)
}

if (unmatched.length > 0) {
  console.log(`\n사람이 처리해야 하는 카드 ${unmatched.length}장:`)
  for (const id of unmatched) console.log(`  ${id}`)
}

if (dryRun) console.log('\n--dry-run 이므로 아무것도 쓰지 않았다.')
