import { describe, expect, it } from 'vitest'
import { buildQueries, reviewDecisionOf } from './github.js'
import type { Config } from './types.js'

function configWith(logins: string[]): Config {
  return {
    upstream: 'facebook/astryx',
    forkRepoName: 'astryx',
    notion: {
      properties: { status: '상태', prUrl: 'PR 링크', syncKey: '동기화 키', date: '날짜' },
      status: { teamReview: 'T', maintainerReview: 'M', merged: 'Merged', closed: 'Closed' },
    },
    titleFormat: '[{name}] {title}',
    members: logins.map((login) => ({ login })),
  }
}

const manyLogins = Array.from({ length: 30 }, (_, i) => `member${String(i).padStart(2, '0')}`)

describe('buildQueries', () => {
  it('멤버가 적으면 쿼리 하나로 끝난다', () => {
    const queries = buildQueries(configWith(['a', 'b']))
    expect(queries).toHaveLength(1)
    expect(queries[0]).toBe('is:pr repo:facebook/astryx repo:a/astryx repo:b/astryx author:a author:b')
  })

  it('256자를 넘지 않게 청크로 나눈다', () => {
    const queries = buildQueries(configWith(manyLogins))
    expect(queries.length).toBeGreaterThan(1)
    for (const q of queries) expect(q.length).toBeLessThanOrEqual(256)
  })

  it('모든 멤버가 정확히 한 번씩 등장한다', () => {
    const tokens = buildQueries(configWith(manyLogins)).flatMap((q) => q.split(' '))
    for (const login of manyLogins) {
      expect(tokens.filter((t) => t === `author:${login}`)).toHaveLength(1)
      expect(tokens.filter((t) => t === `repo:${login}/astryx`)).toHaveLength(1)
    }
  })

  it('모든 청크가 upstream 레포를 포함한다', () => {
    for (const q of buildQueries(configWith(manyLogins))) {
      expect(q).toContain('repo:facebook/astryx')
    }
  })

  it('멤버 하나가 혼자서도 한계를 넘으면 그 멤버만 담은 청크를 만든다', () => {
    const long = 'x'.repeat(400)
    const queries = buildQueries(configWith([long]), 256)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain(`author:${long}`)
  })

  it('멤버가 없으면 쿼리를 만들지 않는다', () => {
    expect(buildQueries(configWith([]))).toEqual([])
  })
})

describe('reviewDecisionOf', () => {
  const node = (...states: string[]) => ({ latestReviews: { nodes: states.map((state) => ({ state })) } })

  it('리뷰가 없으면 null 이다', () => {
    expect(reviewDecisionOf(node())).toBe(null)
    expect(reviewDecisionOf({ latestReviews: null })).toBe(null)
  })

  it('승인만 있으면 APPROVED 다', () => {
    expect(reviewDecisionOf(node('APPROVED'))).toBe('APPROVED')
  })

  // 변경 요청이 하나라도 남아 있으면 다른 승인이 있어도 머지할 수 없다.
  it('변경 요청이 승인을 이긴다', () => {
    expect(reviewDecisionOf(node('APPROVED', 'CHANGES_REQUESTED'))).toBe('CHANGES_REQUESTED')
  })

  it('코멘트만 있으면 null 이다', () => {
    expect(reviewDecisionOf(node('COMMENTED', 'DISMISSED'))).toBe(null)
  })
})
