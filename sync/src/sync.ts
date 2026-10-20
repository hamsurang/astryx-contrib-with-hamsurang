import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.js'
import { fetchIssueWindow, fetchNewIssues, fetchPullRequests } from './github.js'
import { NotionClient } from './notion.js'
import { plan } from './plan.js'
import { issueMessage, messageFor, postSlack, type SlackMessage } from './slack.js'
import type { Action, Issue, PullRequest } from './types.js'

function describe(action: Action): string {
  return action.kind === 'create'
    ? `  생성  ${action.status.padEnd(22)} ${action.title}`
    : `  갱신  ${(action.status ?? '(상태 유지)').padEnd(22)} ${action.key}${action.icon ? ` → ${action.icon}` : ''}`
}

async function collectIssues(upstream: string, repo: string | undefined, runId: string | undefined, token: string): Promise<Issue[]> {
  if (!repo || !runId) {
    console.log('Actions 밖이라 이슈 알림을 건너뛴다.')
    return []
  }
  const window = await fetchIssueWindow(repo, runId, token)
  if (!window) {
    console.log('직전에 성공한 실행이 없어 이슈 알림을 건너뛴다. 다음 실행부터 보낸다.')
    return []
  }
  return fetchNewIssues(upstream, window, token)
}

export async function runSync(options: { dryRun: boolean }): Promise<number> {
  const notionToken = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_DATABASE_ID
  const githubToken = process.env.GITHUB_TOKEN

  if (!notionToken) throw new Error('NOTION_TOKEN 이 없다')
  if (!databaseId) throw new Error('NOTION_DATABASE_ID 가 없다')
  if (!githubToken) throw new Error('GITHUB_TOKEN 이 없다')

  // Slack 은 선택이다. webhook 이 없으면 그 채널 알림만 건너뛴다.
  const teamWebhook = process.env.SLACK_WEBHOOK_TEAM
  const issuesWebhook = process.env.SLACK_WEBHOOK_ISSUES
  // 이슈 구간은 Actions 실행 기록으로 정한다. Actions 밖(로컬)에서는 이슈 알림을 건너뛴다.
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID

  const config = loadConfig(fileURLToPath(new URL('..', import.meta.url)), fileURLToPath(new URL('../..', import.meta.url)))
  const notion = new NotionClient(notionToken, databaseId, config)

  await notion.verifySchema()

  // 수집은 전부-아니면-전무다. 여기서 예외가 나면 아무것도 쓰지 않고 끝난다.
  const [prs, cards, issues] = await Promise.all([
    fetchPullRequests(config, githubToken),
    notion.fetchCards(),
    collectIssues(config.upstream, repo, runId, githubToken),
  ])

  const { actions, warnings } = plan(prs, cards, config)

  // update 작업에는 PR 정보가 없어 메시지를 만들 수 없다. 알림 대상은 모두 upstream PR 이므로
  // 키별 upstream PR 을 고른다. plan 의 대표 선택과 같게 최신 createdAt 을 쓴다.
  const upstreamByKey = new Map<string, PullRequest>()
  for (const pr of prs) {
    const prev = upstreamByKey.get(pr.key)
    if (pr.isUpstream && (!prev || pr.createdAt > prev.createdAt)) upstreamByKey.set(pr.key, pr)
  }
  const teamMessage = (action: Action): SlackMessage | null => {
    const pr = upstreamByKey.get(action.key)
    return pr ? messageFor(action, pr, config) : null
  }

  console.log(`PR ${prs.length}건, 카드 ${cards.length}장 → 작업 ${actions.length}건, 새 이슈 ${issues.length}건`)
  for (const warning of warnings) console.warn(`  경고  ${warning}`)
  for (const action of actions) console.log(describe(action))

  if (options.dryRun) {
    for (const message of actions.map(teamMessage).filter((m) => m !== null)) console.log(`  팀 알림\n${message.text}\n`)
    for (const issue of issues) console.log(`  이슈 알림\n${issueMessage(issue).text}\n`)
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
      continue
    }

    // 카드가 반영된 뒤에만 보낸다. 카드가 상태를 기억하므로 같은 알림은 다시 나가지 않는다.
    // 대신 여기서 Slack 이 실패하면 그 알림은 재시도되지 않는다. 경고만 남긴다.
    const message = teamMessage(action)
    if (teamWebhook && message) {
      await postSlack(teamWebhook, message).catch((error) => {
        console.warn(`  경고  팀 알림 실패 ${action.key}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  // 이슈 알림 실패는 실행 실패로 만든다. 다음 실행이 같은 구간부터 다시 보낸다.
  if (issuesWebhook) {
    for (const issue of issues) {
      try {
        await postSlack(issuesWebhook, issueMessage(issue))
      } catch (error) {
        failures.push(`이슈 #${issue.number}: ${error instanceof Error ? error.message : String(error)}`)
      }
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
