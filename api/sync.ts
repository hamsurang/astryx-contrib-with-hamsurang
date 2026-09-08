/**
 * GitHub Actions 의 schedule 은 실행을 보장하지 않는다. 10 분 주기로 두었을 때
 * 실측 간격이 92~501 분이었고 슬롯 대부분이 통째로 건너뛰어졌다. 그래서 시계를
 * GitHub 밖에 두고 Vercel Cron 이 workflow_dispatch 를 대신 찌른다.
 *
 * sync.yml 은 손대지 않는다. 이미 workflow_dispatch 를 받고 있다.
 */

const WORKFLOW_DISPATCH =
  'https://api.github.com/repos/hamsurang/contrib-board-sync/actions/workflows/sync.yml/dispatches'

export async function GET(request: Request): Promise<Response> {
  // CRON_SECRET 이 설정돼 있으면 Vercel 이 cron 호출에 이 헤더를 붙인다.
  // 이 엔드포인트가 공개 URL 이므로 이것이 유일한 차단 장치다.
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const token = process.env.GH_PAT
  if (!token) return new Response('GH_PAT is not set', { status: 500 })

  const response = await fetch(WORKFLOW_DISPATCH, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    // dryRun 을 문자열 "false" 로 명시해야 한다. 빼면 워크플로 입력 기본값인
    // true 가 적용돼 계획만 출력하고 Notion 에 아무것도 쓰지 않는다.
    body: JSON.stringify({ ref: 'main', inputs: { dryRun: 'false' } }),
  })

  // 성공은 204 No Content. 본문이 없는 것이 정상이다.
  if (!response.ok) {
    const body = await response.text()
    return new Response(`dispatch failed: ${response.status} ${body}`, { status: 502 })
  }
  return new Response(null, { status: 204 })
}
