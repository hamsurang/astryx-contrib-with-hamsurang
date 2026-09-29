import type { Config, PrState, PullRequest } from './types.js'

const ENDPOINT = 'https://api.github.com/graphql'
const MAX_QUERY_LENGTH = 256

const SEARCH = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        title url state createdAt headRefName
        author { login ... on User { name } }
        repository { nameWithOwner }
      }
    }
  }
}`

/**
 * GitHub search 는 검색어를 256자로 제한한다. 멤버 한 명이 repo: 와 author: 로
 * 약 35자를 쓰므로 한 쿼리에 6~7명이 한계다. 청크로 나눠 여러 번 질의한다.
 * 모든 청크가 upstream 레포를 포함해야 그 청크에 속한 멤버의 upstream PR 이 잡힌다.
 */
export function buildQueries(config: Config, maxLen: number = MAX_QUERY_LENGTH): string[] {
  const base = `is:pr repo:${config.upstream}`
  const queries: string[] = []

  let repos: string[] = []
  let authors: string[] = []

  const render = () => `${base} ${[...repos, ...authors].join(' ')}`

  for (const member of config.members) {
    const repo = `repo:${member.login}/${config.forkRepoName}`
    const author = `author:${member.login}`
    const candidate = `${base} ${[...repos, repo, ...authors, author].join(' ')}`

    // 멤버 하나만으로도 한계를 넘으면 쪼갤 수 없다. 그 멤버만 담은 청크를 만들고 넘어간다.
    if (candidate.length > maxLen && repos.length > 0) {
      queries.push(render())
      repos = [repo]
      authors = [author]
      continue
    }

    repos.push(repo)
    authors.push(author)
  }

  if (repos.length > 0) queries.push(render())
  return queries
}

type SearchNode = {
  title: string
  url: string
  state: PrState
  createdAt: string
  headRefName: string
  author: { login: string; name?: string | null } | null
  repository: { nameWithOwner: string } | null
}

type SearchResponse = {
  errors?: { message: string }[]
  data?: {
    search: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: (SearchNode | null)[]
    }
  }
}

async function runQuery(q: string, token: string): Promise<SearchNode[]> {
  const nodes: SearchNode[] = []
  let after: string | null = null

  do {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'contrib-board-sync',
      },
      body: JSON.stringify({ query: SEARCH, variables: { q, after } }),
    })

    if (!response.ok) {
      throw new Error(`GitHub GraphQL ${response.status}: ${await response.text()}`)
    }

    const body = (await response.json()) as SearchResponse

    if (body.errors?.length) {
      throw new Error(`GitHub GraphQL: ${body.errors.map((e) => e.message).join('; ')}`)
    }

    const search = body.data?.search
    if (!search) throw new Error('GitHub GraphQL: 응답에 search 가 없다')

    // type: ISSUE 검색은 이슈도 함께 반환한다. PullRequest 가 아닌 노드는 빈 객체로 온다.
    for (const node of search.nodes) {
      if (node?.repository && node.headRefName) nodes.push(node)
    }

    after = search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null
  } while (after !== null)

  return nodes
}

/**
 * 수집은 전부-아니면-전무다. 한 청크라도 실패하면 예외를 던져 아무것도 쓰지 않게 한다.
 * 부분 목록으로 계획을 세우면 존재하는 PR 을 못 봤다는 이유로 카드를 새로 만들게 된다.
 */
export async function fetchPullRequests(config: Config, token: string): Promise<PullRequest[]> {
  const queries = buildQueries(config)
  const batches = await Promise.all(queries.map((q) => runQuery(q, token)))

  const seen = new Set<string>()
  const prs: PullRequest[] = []

  for (const node of batches.flat()) {
    if (!node.author || !node.repository) continue
    if (seen.has(node.url)) continue
    seen.add(node.url)

    prs.push({
      key: `${node.author.login}:${node.headRefName}`,
      login: node.author.login,
      displayName: node.author.name ?? null,
      title: node.title,
      url: node.url,
      repo: node.repository.nameWithOwner,
      isUpstream: node.repository.nameWithOwner === config.upstream,
      state: node.state,
      createdAt: node.createdAt,
    })
  }

  return prs
}
