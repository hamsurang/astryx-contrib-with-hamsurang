import type { Config, Issue, PrState, PullRequest, ReviewDecision } from './types.js'

const ENDPOINT = 'https://api.github.com/graphql'
const MAX_QUERY_LENGTH = 256

const SEARCH = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        title url state createdAt headRefName
        number additions deletions changedFiles
        labels(first: 10) { nodes { name } }
        closingIssuesReferences(first: 5) { nodes { number } }
        latestReviews(first: 10) { nodes { state } }
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
  number: number
  additions: number
  deletions: number
  changedFiles: number
  labels?: { nodes: ({ name: string } | null)[] } | null
  closingIssuesReferences?: { nodes: ({ number: number } | null)[] } | null
  latestReviews: { nodes: ({ state: string } | null)[] } | null
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

/**
 * 리뷰 결정. reviewDecision 은 브랜치 보호 규칙이 없는 레포에서 항상 null 이라 쓸 수
 * 없다. latestReviews 는 리뷰어별 최신 리뷰만 주므로 GitHub 이 보여주는 것과 같다.
 * 변경 요청이 하나라도 남아 있으면 다른 승인이 있어도 변경 요청이 이긴다.
 */
export function reviewDecisionOf(node: Pick<SearchNode, 'latestReviews'>): ReviewDecision {
  const states = (node.latestReviews?.nodes ?? []).map((r) => r?.state)
  if (states.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED'
  if (states.includes('APPROVED')) return 'APPROVED'
  return null
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

    // members.yml 의 name 이 GitHub 프로필 이름보다 우선한다.
    const member = config.members.find((m) => m.login === node.author!.login)

    prs.push({
      key: `${node.author.login}:${node.headRefName}`,
      login: node.author.login,
      displayName: member?.name ?? node.author.name ?? null,
      title: node.title,
      url: node.url,
      repo: node.repository.nameWithOwner,
      isUpstream: node.repository.nameWithOwner === config.upstream,
      state: node.state,
      reviewDecision: reviewDecisionOf(node),
      createdAt: node.createdAt,
      number: node.number,
      additions: node.additions,
      deletions: node.deletions,
      changedFiles: node.changedFiles,
      labels: (node.labels?.nodes ?? []).flatMap((l) => (l ? [l.name] : [])),
      closingIssues: (node.closingIssuesReferences?.nodes ?? []).flatMap((i) => (i ? [i.number] : [])),
    })
  }

  return prs
}

async function rest<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'contrib-board-sync',
    },
  })
  if (!response.ok) throw new Error(`GitHub REST ${response.status}: ${await response.text()}`)
  return (await response.json()) as T
}

type WorkflowRun = { id: number; workflow_id: number; display_title: string; run_started_at: string }

export type IssueWindow = { from: string; to: string }

/**
 * 새 이슈를 알릴 구간. 직전에 성공한 실행의 시작 시각부터 이번 실행의 시작 시각까지다.
 * 실행이 불규칙해도 구간이 빈틈 없이 이어져서 놓치는 이슈가 없다. dry-run 실행은
 * 아무것도 보내지 않았으므로 건너뛴다(sync.yml 의 run-name 에 dry-run 을 표시한다).
 * 성공한 실행이 없으면 null 이다 — 첫 실행에 과거 이슈를 전부 쏟아내지 않기 위해서다.
 */
export async function fetchIssueWindow(repo: string, runId: string, token: string): Promise<IssueWindow | null> {
  const current = await rest<WorkflowRun>(`/repos/${repo}/actions/runs/${runId}`, token)
  // ponytail: 최근 성공 50건 안에 실제 실행이 없으면 null. dry-run 만 50번 연속일 일은 없다.
  const { workflow_runs } = await rest<{ workflow_runs: WorkflowRun[] }>(
    `/repos/${repo}/actions/workflows/${current.workflow_id}/runs?status=success&per_page=50`,
    token,
  )
  const previous = workflow_runs.find((run) => run.id !== current.id && !run.display_title.includes('dry-run'))
  return previous ? { from: previous.run_started_at, to: current.run_started_at } : null
}

type IssueSearchResponse = {
  items: {
    number: number
    title: string
    html_url: string
    body: string | null
    user: { login: string } | null
    labels: { name: string }[]
  }[]
}

export async function fetchNewIssues(upstream: string, window: IssueWindow, token: string): Promise<Issue[]> {
  const q = encodeURIComponent(`repo:${upstream} is:issue created:${window.from}..${window.to}`)
  // ponytail: 한 페이지(100건)만 본다. 한 구간에 이슈가 100건을 넘으면 페이지네이션을 붙인다.
  const { items } = await rest<IssueSearchResponse>(`/search/issues?q=${q}&sort=created&order=asc&per_page=100`, token)
  return items.map((item) => ({
    number: item.number,
    title: item.title,
    url: item.html_url,
    author: item.user?.login ?? 'ghost',
    body: item.body ?? '',
    labels: item.labels.map((l) => l.name),
  }))
}
