import { describe, expect, it } from 'vitest'
import { issueMessage, messageFor } from './slack.js'
import type { Action, Config, PullRequest } from './types.js'

const config: Config = {
  upstream: 'facebook/astryx',
  forkRepoName: 'astryx',
  notion: {
    properties: { status: '상태', prUrl: 'PR 링크', syncKey: '동기화 키', date: '날짜' },
    status: {
      teamReview: 'In Team-Review',
      maintainerReview: 'In Maintainer-Review',
      merged: 'Merged',
      closed: 'Closed',
    },
    icons: { approved: '✅', changesRequested: '❗', pending: '🔄' },
  },
  titleFormat: '[{name}] {title}',
  members: [{ login: 'Kyujenius' }],
}

const pr: PullRequest = {
  key: 'Kyujenius:fix/a',
  login: 'Kyujenius',
  displayName: '홍규진',
  title: 'fix: a <b> & c',
  url: 'https://github.com/facebook/astryx/pull/1',
  repo: 'facebook/astryx',
  isUpstream: true,
  state: 'OPEN',
  reviewDecision: null,
  createdAt: '2026-10-17T00:00:00Z',
  number: 1,
  additions: 42,
  deletions: 8,
  changedFiles: 3,
  labels: ['CLA Signed', 'a11y', 'community'],
  closingIssues: [7650],
}

const now = new Date('2026-10-20T01:00:00Z')

const update = (over: Partial<Extract<Action, { kind: 'update' }>>): Action => ({ kind: 'update', pageId: 'p', key: pr.key, ...over })

describe('messageFor', () => {
  it.each([
    [update({ status: 'In Maintainer-Review' }), '🚀 upstream 에 PR 을 열었어요'],
    [update({ status: 'Merged' }), '🎉 PR 이 머지됐어요!'],
    [update({ status: 'Closed' }), 'PR 이 close 됐어요😭'],
    [update({ icon: '✅' }), '✅ 리뷰가 승인됐어요!'],
    [update({ icon: '❗' }), '❗ 변경 요청이 왔어요!'],
  ])('%o → %s', (action, event) => {
    expect(messageFor(action, pr, config, now)?.text).toContain(event)
  })

  it('upstream PR 이 열리며 승인까지 난 경우 열림만 알린다', () => {
    const create: Action = { kind: 'create', key: pr.key, title: 't', status: 'In Maintainer-Review', prUrl: pr.url, date: '2026-10-20', icon: '✅' }
    const text = messageFor(create, pr, config, now)?.text
    expect(text).toContain('열었어요')
    expect(text).not.toContain('승인')
    // 막 연 PR 에는 경과 시간을 붙이지 않는다.
    expect(text).not.toContain('연 지')
  })

  it('알릴 변화가 없으면 null 이다', () => {
    expect(messageFor(update({ status: 'In Team-Review' }), pr, config)).toBeNull()
    expect(messageFor(update({ icon: '🔄' }), pr, config)).toBeNull()
    expect(messageFor(update({ prUrl: 'x' }), pr, config)).toBeNull()
  })

  it('변경 규모·경과 시간·연결 이슈·라벨을 담고 이벤트 색을 쓴다', () => {
    const message = messageFor(update({ status: 'Merged' }), pr, config, now)!
    expect(message.color).toBe('#8250df')
    expect(message.text).toContain('+42 −8 · 파일 3개 · 연 지 3일 · 연결 이슈 <https://github.com/facebook/astryx/issues/7650|#7650>')
    expect(message.text).toContain('라벨: a11y')
  })

  it('제목의 mrkdwn 특수문자를 이스케이프한다', () => {
    expect(messageFor(update({ status: 'Merged' }), pr, config, now)?.text).toContain('fix: a &lt;b&gt; &amp; c')
  })
})

describe('issueMessage', () => {
  const issue = { number: 7, title: 'bug', url: 'https://x/7', author: 'someone', body: '', labels: [] as string[] }

  it('본문은 공백을 접고 200자에서 자른다', () => {
    const text = issueMessage({ ...issue, body: `a\n\n${'b'.repeat(300)}`, labels: ['bug'] }).text
    expect(text).toContain(`> a ${'b'.repeat(198)}…`)
    expect(text).toContain('라벨: bug')
  })

  it('본문·라벨이 없으면 그 줄을 뺀다', () => {
    expect(issueMessage(issue).text).toBe('🆕 *새 이슈* <https://x/7|#7 bug>\nby <https://github.com/someone|@someone>')
  })
})
