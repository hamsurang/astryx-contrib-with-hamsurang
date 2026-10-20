import type { Action, Config, Issue, PullRequest } from './types.js'

/** 색 막대 하나짜리 attachment. fallback 은 푸시 알림과 미리보기에 쓰인다. */
export type SlackMessage = { color: string; fallback: string; text: string }

const DAY = 24 * 60 * 60 * 1000
const PREVIEW_LENGTH = 200

/** Slack mrkdwn 은 &, <, > 만 이스케이프하면 된다. 링크 문법 <url|text> 이 깨지지 않게 한다. */
function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 모든 PR 에 붙어서 정보가 없는 라벨. */
const HIDDEN_LABELS = new Set(['CLA Signed', 'community'])

function labelsLine(labels: string[]): string | null {
  const shown = labels.filter((label) => !HIDDEN_LABELS.has(label))
  return shown.length > 0 ? `라벨: ${shown.map(escape).join(', ')}` : null
}

/**
 * 팀 채널 메시지. 알릴 변화가 없으면 null 이다. 상태 변화가 아이콘 변화보다 우선한다 —
 * upstream PR 이 열리자마자 approve 까지 난 경우 "열었어요" 한 번만 보낸다.
 * fork PR(Team-Review)은 upstream 기여가 아니라서 알리지 않는다.
 */
export function messageFor(action: Action, pr: PullRequest, config: Config, now = new Date()): SlackMessage | null {
  const s = config.notion.status
  const icons = config.notion.icons

  let event: { headline: string; color: string } | null = null
  if (action.status === s.maintainerReview) event = { headline: '🚀 upstream 에 PR 을 열었어요', color: '#0969da' }
  else if (action.status === s.merged) event = { headline: '🎉 PR 이 머지됐어요!', color: '#8250df' }
  else if (action.status === s.closed) event = { headline: 'PR 이 close 됐어요😭', color: '#6e7781' }
  else if (icons && action.icon === icons.approved) event = { headline: '✅ 리뷰가 승인됐어요!', color: '#1a7f37' }
  else if (icons && action.icon === icons.changesRequested) event = { headline: '❗ 변경 요청이 왔어요!', color: '#bc4c00' }
  if (event === null) return null

  const name = escape(pr.displayName ?? pr.login)
  // ponytail: 경과 시간은 PR 생성부터 이번 실행까지다. 실행이 늦으면 그만큼 늘어난다.
  const days = Math.floor((now.getTime() - new Date(pr.createdAt).getTime()) / DAY)
  const opened = action.status === s.maintainerReview
  const issues = pr.closingIssues.map((n) => `<https://github.com/${pr.repo}/issues/${n}|#${n}>`).join(', ')

  const meta = [
    `+${pr.additions} −${pr.deletions}`,
    `파일 ${pr.changedFiles}개`,
    opened ? null : days === 0 ? '오늘 연 PR' : `연 지 ${days}일`,
    issues ? `연결 이슈 ${issues}` : null,
  ].filter((part) => part !== null)

  const lines = [
    `*${name}* 님 ${event.headline}`,
    `<${pr.url}|${escape(pr.title)}>  #${pr.number}`,
    meta.join(' · '),
    labelsLine(pr.labels),
  ].filter((line) => line !== null)

  return { color: event.color, fallback: `${pr.displayName ?? pr.login} 님 ${event.headline}`, text: lines.join('\n') }
}

export function issueMessage(issue: Issue): SlackMessage {
  const body = issue.body.replace(/\s+/g, ' ').trim()
  const preview = body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}…` : body

  const lines = [
    `🆕 *새 이슈* <${issue.url}|#${issue.number} ${escape(issue.title)}>`,
    `by <https://github.com/${issue.author}|@${escape(issue.author)}>`,
    labelsLine(issue.labels),
    preview ? `> ${escape(preview)}` : null,
  ].filter((line) => line !== null)

  return { color: '#0969da', fallback: `새 이슈 #${issue.number} ${issue.title}`, text: lines.join('\n') }
}

export async function postSlack(webhookUrl: string, message: SlackMessage): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments: [{ ...message, mrkdwn_in: ['text'] }] }),
  })
  if (!response.ok) throw new Error(`Slack ${response.status}: ${await response.text()}`)
}
