import { describe, expect, it } from 'vitest'
import { plan } from './plan.js'
import type { Card, Config, PullRequest } from './types.js'

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
  },
  titleFormat: '[{name}] {title}',
  members: [{ login: 'Kyujenius' }],
}

function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    key: 'Kyujenius:fix/a',
    login: 'Kyujenius',
    displayName: '홍규진',
    title: 'fix(docsite): show Tokenizer',
    url: 'https://github.com/facebook/astryx/pull/5982',
    repo: 'facebook/astryx',
    isUpstream: true,
    state: 'OPEN',
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  }
}

function card(over: Partial<Card> = {}): Card {
  return { pageId: 'p1', key: 'Kyujenius:fix/a', status: null, prUrl: null, ...over }
}

describe('plan — 카드 생성', () => {
  it('fork PR 이 열려 있고 카드가 없으면 Team-Review 카드를 만든다', () => {
    const { actions } = plan([pr({ isUpstream: false, repo: 'Kyujenius/astryx' })], [], config)
    expect(actions).toEqual([
      {
        kind: 'create',
        key: 'Kyujenius:fix/a',
        title: '[홍규진] fix(docsite): show Tokenizer',
        status: 'In Team-Review',
        prUrl: 'https://github.com/facebook/astryx/pull/5982',
        date: '2026-09-01',
      },
    ])
  })

  const team: Config = {
    ...config,
    members: [
      { login: 'Kyujenius', notionUserId: 'u-1' },
      { login: 'azure-553', notionUserId: 'u-2' },
      { login: 'korkt-kim' },
    ],
  }

  it('Team-Review 카드는 작성자를 앞세워 notionUserId 가 있는 멤버 전원을 담당자로 싣는다', () => {
    const { actions } = plan([pr({ isUpstream: false, repo: 'Kyujenius/astryx' })], [], team)
    expect(actions[0]).toMatchObject({ status: 'In Team-Review', assigneeIds: ['u-1', 'u-2'] })
  })

  it('Team-Review 가 아닌 카드는 작성자만 담당자로 싣는다', () => {
    const { actions } = plan([pr()], [], team)
    expect(actions[0]).toMatchObject({ status: 'In Maintainer-Review', assigneeIds: ['u-1'] })
  })

  it('작성자에게 notionUserId 가 없어도 Team-Review 카드에는 나머지 멤버를 싣는다', () => {
    const { actions } = plan([pr({ login: 'korkt-kim', isUpstream: false, repo: 'korkt-kim/astryx' })], [], team)
    expect(actions[0]).toMatchObject({ assigneeIds: ['u-1', 'u-2'] })
  })

  it('notionUserId 가 하나도 없으면 assigneeIds 를 싣지 않는다', () => {
    const { actions } = plan([pr()], [], config)
    expect(actions[0]).not.toHaveProperty('assigneeIds')
  })

  it('upstream PR 이 열려 있고 카드가 없으면 Maintainer-Review 카드를 만든다', () => {
    const { actions } = plan([pr()], [], config)
    expect(actions[0]).toMatchObject({ kind: 'create', status: 'In Maintainer-Review' })
  })

  it('displayName 이 없으면 login 으로 제목을 만든다', () => {
    const { actions } = plan([pr({ displayName: null })], [], config)
    expect(actions[0]).toMatchObject({ title: '[Kyujenius] fix(docsite): show Tokenizer' })
  })
})

describe('plan — 상태 이동', () => {
  it('같은 키의 upstream PR 이 열리면 카드를 Maintainer-Review 로 옮긴다', () => {
    const { actions } = plan([pr()], [card({ status: 'In Team-Review' })], config)
    expect(actions).toEqual([
      {
        kind: 'update',
        pageId: 'p1',
        key: 'Kyujenius:fix/a',
        status: 'In Maintainer-Review',
        prUrl: 'https://github.com/facebook/astryx/pull/5982',
      },
    ])
  })

  it('upstream PR 이 머지되면 Merged 로 옮긴다', () => {
    const { actions } = plan([pr({ state: 'MERGED' })], [card({ status: 'In Maintainer-Review' })], config)
    expect(actions[0]).toMatchObject({ kind: 'update', status: 'Merged' })
  })

  it('upstream PR 이 미머지 close 되면 Closed 로 옮긴다', () => {
    const { actions } = plan([pr({ state: 'CLOSED' })], [card({ status: 'In Maintainer-Review' })], config)
    expect(actions[0]).toMatchObject({ kind: 'update', status: 'Closed' })
  })
})

describe('plan — fork PR 종료는 아무것도 하지 않는다', () => {
  const forkMerged = pr({ isUpstream: false, repo: 'Kyujenius/astryx', state: 'MERGED' })

  it('fork PR 이 머지돼도 카드를 옮기지 않는다', () => {
    const { actions } = plan([forkMerged], [card({ status: 'In Team-Review' })], config)
    expect(actions).toEqual([])
  })

  it('fork PR 이 머지됐고 카드가 없으면 만들지도 않는다', () => {
    expect(plan([forkMerged], [], config).actions).toEqual([])
  })

  it('fork PR 이 닫혀도 아무것도 하지 않는다', () => {
    const forkClosed = pr({ isUpstream: false, repo: 'Kyujenius/astryx', state: 'CLOSED' })
    expect(plan([forkClosed], [card({ status: 'In Team-Review' })], config).actions).toEqual([])
  })
})

describe('plan — 경계와 멱등성', () => {
  it('동기화 키가 빈 카드는 완전히 무시한다', () => {
    const orphan = card({ pageId: 'before-1', key: null, status: 'Before' })
    const { actions } = plan([], [orphan], config)
    expect(actions).toEqual([])
  })

  it('목표 상태가 현재와 같고 링크도 같으면 아무 작업도 만들지 않는다', () => {
    const settled = card({
      status: 'In Maintainer-Review',
      prUrl: 'https://github.com/facebook/astryx/pull/5982',
    })
    expect(plan([pr()], [settled], config).actions).toEqual([])
  })

  it('상태는 같고 링크만 다르면 링크만 갱신한다', () => {
    const settled = card({ status: 'In Maintainer-Review', prUrl: 'https://old' })
    const { actions } = plan([pr()], [settled], config)
    expect(actions).toEqual([
      {
        kind: 'update',
        pageId: 'p1',
        key: 'Kyujenius:fix/a',
        prUrl: 'https://github.com/facebook/astryx/pull/5982',
      },
    ])
  })

  it('대응하는 PR 이 없는 카드는 건드리지 않는다', () => {
    expect(plan([], [card({ status: 'Merged' })], config).actions).toEqual([])
  })
})

describe('plan — 같은 키에 PR 이 여럿', () => {
  it('upstream 을 fork 보다 우선한다', () => {
    const fork = pr({ isUpstream: false, repo: 'Kyujenius/astryx', createdAt: '2026-09-03T00:00:00Z' })
    const { actions } = plan([fork, pr()], [], config)
    expect(actions[0]).toMatchObject({ status: 'In Maintainer-Review' })
  })

  it('upstream 이 여럿이면 가장 최근 것을 쓴다', () => {
    const older = pr({ state: 'CLOSED', createdAt: '2026-08-01T00:00:00Z', url: 'https://old' })
    const newer = pr({ state: 'OPEN', createdAt: '2026-09-01T00:00:00Z', url: 'https://new' })
    const { actions } = plan([older, newer], [], config)
    expect(actions[0]).toMatchObject({ status: 'In Maintainer-Review', prUrl: 'https://new' })
  })
})

describe('plan — 경고', () => {
  it('같은 키를 가진 카드가 둘이면 경고하고 첫 카드만 쓴다', () => {
    const dup = [card({ pageId: 'p1' }), card({ pageId: 'p2' })]
    const { actions, warnings } = plan([pr()], dup, config)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ pageId: 'p1' })
    expect(warnings[0]).toContain('Kyujenius:fix/a')
  })
})
