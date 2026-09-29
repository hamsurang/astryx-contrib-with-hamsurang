import type { Action, Card, Config, PlanResult, PullRequest } from './types.js'

type UpdateAction = Extract<Action, { kind: 'update' }>

/** 같은 키의 PR 중 대표 하나를 고른다. upstream 우선, 그다음 최신 createdAt. */
function pickRepresentative(prs: PullRequest[]): PullRequest {
  const sorted = [...prs].sort((a, b) => {
    if (a.isUpstream !== b.isUpstream) return a.isUpstream ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })
  return sorted[0]!
}

/**
 * 보드에 놓일 상태. null 이면 아무 작업도 하지 않는다.
 *
 * fork PR 이 머지되거나 닫히면 null 이다. fork 에 머지된 것은 기여 완료가 아니라서
 * Merged 칸으로 보내면 그 칸이 실제 upstream 기여와 뒤섞인다. 같은 브랜치의
 * upstream PR 이 열릴 때까지 카드를 그대로 둔다.
 */
function targetStatus(pr: PullRequest, config: Config): string | null {
  const s = config.notion.status
  if (!pr.isUpstream) return pr.state === 'OPEN' ? s.teamReview : null
  if (pr.state === 'OPEN') return s.maintainerReview
  return pr.state === 'MERGED' ? s.merged : s.closed
}

function formatTitle(pr: PullRequest, config: Config): string {
  return config.titleFormat
    .replaceAll('{name}', pr.displayName ?? pr.login)
    .replaceAll('{title}', pr.title)
}

/**
 * 생성 시 담당자. Team-Review 카드는 팀 리뷰 요청이라 notionUserId 가 있는 멤버 전원을
 * 넣어 알림이 가게 한다(작성자가 맨 앞). 그 외 칸은 작성자만 넣는다.
 */
function assigneesFor(pr: PullRequest, status: string, config: Config): string[] {
  const author = config.members.find((m) => m.login === pr.login)?.notionUserId
  if (status !== config.notion.status.teamReview) return author ? [author] : []
  const others = config.members
    .filter((m) => m.login !== pr.login && m.notionUserId)
    .map((m) => m.notionUserId!)
  return author ? [author, ...others] : others
}

export function plan(prs: PullRequest[], cards: Card[], config: Config): PlanResult {
  const warnings: string[] = []

  // 동기화 키가 빈 카드는 자동화 영역 밖이다. 여기서 제외하면 이후 어떤 경로로도
  // 건드릴 수 없게 된다. Before 칸을 사람 영역으로 남기는 장치다.
  const byKey = new Map<string, Card>()
  for (const card of cards) {
    if (card.key === null) continue
    const existing = byKey.get(card.key)
    if (existing) {
      warnings.push(`동기화 키가 중복된 카드가 있다: ${card.key} (${existing.pageId} 를 쓰고 ${card.pageId} 는 건너뛴다)`)
      continue
    }
    byKey.set(card.key, card)
  }

  const grouped = new Map<string, PullRequest[]>()
  for (const pr of prs) {
    const bucket = grouped.get(pr.key)
    if (bucket) bucket.push(pr)
    else grouped.set(pr.key, [pr])
  }

  const actions: Action[] = []

  for (const [key, group] of grouped) {
    const pr = pickRepresentative(group)
    const status = targetStatus(pr, config)
    if (status === null) continue

    const card = byKey.get(key)

    if (!card) {
      const assigneeIds = assigneesFor(pr, status, config)
      actions.push({
        kind: 'create',
        key,
        title: formatTitle(pr, config),
        status,
        prUrl: pr.url,
        date: pr.createdAt.slice(0, 10),
        ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
      })
      continue
    }

    const update: UpdateAction = { kind: 'update', pageId: card.pageId, key }
    if (card.status !== status) update.status = status
    if (card.prUrl !== pr.url) update.prUrl = pr.url
    if (update.status !== undefined || update.prUrl !== undefined) actions.push(update)
  }

  return { actions, warnings }
}
