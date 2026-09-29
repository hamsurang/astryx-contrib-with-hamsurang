# contrib-board-sync

GitHub PR 상태를 Notion 기여 보드에 자동으로 반영한다.

함수랑은 `facebook/astryx` 기여 현황을 Notion 보드로 관리한다. 상태 이동이 전부
수동이라 실제 PR 상태와 금세 어긋난다. 이 도구는 GitHub을 진실의 원천으로 삼아
10분마다 보드를 맞춘다. GitHub Actions에서 돌고, 서버가 필요 없다.

> 아직 설계만 있고 구현은 없다. 아래 문서는 만들려는 것의 명세다.

## 무엇을 하나

- PR이 어느 레포를 향하는지에 따라 카드를 올바른 칸으로 옮긴다.
- 보드에 없는 PR을 발견하면 카드를 만든다.
- 사람이 쓴 정보(만족도, 담당자, 제목에 덧붙인 메모)는 건드리지 않는다.

## 상태 매핑

PR이 *어느 레포를 향하는지*가 리뷰 단계를 가른다. 라벨이나 draft 규율과 달리
사람이 뭘 잊어서 틀어질 여지가 없다.

| GitHub 상태 | 보드 |
| --- | --- |
| `<멤버>/astryx`로 열린 PR | In Team-Review |
| `facebook/astryx`로 열린 PR | In Maintainer-Review |
| upstream PR이 merged | Merged |
| upstream PR이 미머지 close | Closed |
| fork PR이 merged / closed | **아무것도 안 함** |

마지막 줄이 중요하다. fork에 머지된 것은 기여 완료가 아니다. 그걸 `Merged`로
보내면 그 칸이 실제 upstream 기여와 fork 머지로 뒤섞인다. 대응하는 upstream PR이
나타날 때까지 카드는 In Team-Review에 그대로 있는다.

`Before`는 자동화가 만들지도 옮기지도 않는다. 아래 "사람과 자동화의 경계"를 보라.

## 카드를 무엇으로 식별하나

```
{author.login}:{headRefName}

Kyujenius:fix/dropdown-menu-radio-group-preview
```

fork main으로 쏜 PR과 upstream으로 쏜 PR은 **서로 다른 PR**이라 URL도 번호도
바뀐다. 하지만 head 브랜치 이름은 같다. 그래서 링크가 아니라 브랜치명을 키로
삼아야 카드 한 장이 Team-Review부터 Merged까지 끝까지 따라간다.

Notion DB의 `동기화 키` 속성에 이 값을 저장한다. `PR 링크`는 사람이 보라고
채우되 키 역할은 하지 않는다.

**전제: 브랜치 이름을 재사용하지 않는다.** 같은 키를 가진 PR이 여럿 발견되면
upstream을 우선하고, 그 안에서 가장 최근에 만들어진 것을 택한다.

## 사람과 자동화의 경계

| | 속성 |
| --- | --- |
| 자동화가 계속 관리 | `상태` · `PR 링크` · `동기화 키` |
| 생성 시에만 쓰고 이후 안 건드림 | 제목 · `날짜` · `담당자` |
| 절대 안 건드림 | `선택`(만족도) |

제목은 사람이 메모를 덧붙이는 자리다. PR 제목이 바뀌었다고 그걸 지우면 안 된다.
만족도는 사람만 아는 정보이고 자동화가 지우면 복구할 수 없다.

**`동기화 키`가 비어 있는 카드는 자동화가 완전히 무시한다.** 이것이 `Before` 칸을
사람 영역으로 남기는 장치다. "이거 할 거임" 카드를 만들어두고 나중에 PR을 올리면,
백필이나 다음 실행이 키를 채우면서 자동화가 인수한다.

**사람이 손으로 옮긴 상태는 다음 실행에 되돌아간다.** GitHub이 진실이라는 원칙에
따른 동작이다. 되돌림이 실제로 거슬리면 그때 `수동 고정` 체크박스 속성을 추가해
켜진 카드를 건너뛰게 한다.

`담당자`는 `members.yml`의 `notionUserId`가 있는 멤버에 한해 생성 시에만 채운다.
`In Team-Review`로 만들어지는 카드는 팀 리뷰 요청이므로 작성자를 앞세워 멤버 전원을
넣어 알림이 가게 하고, 다른 칸으로 만들어지는 카드는 작성자만 넣는다.
Notion people 타입이라 GitHub 계정과 잇는 매핑이 필요하고, 이름으로 추측하면
동명이인에서 사고가 나므로 id 를 명시한다. id 가 없는 멤버는 비워둔다.
`config.yml`의 `notion.properties.assignee`를 빼면 아예 채우지 않는다.

## 설치

### 1. Notion integration

**워크스페이스 admin에게 부탁해야 한다.** 멤버 권한으로 우회하는 방법은 없다.
필요한 건 한 번, 5분이다.

1. Notion 설정 → Connections → integration 생성 (internal)
2. 시크릿을 받는다
3. 대상 보드 페이지에서 `⋯ → Connections`로 그 integration을 연결한다

### 2. 시크릿 등록

레포 `Settings → Secrets and variables → Actions`에 두 개를 넣는다.
`.env.example`에 이름이 적혀 있다.

| 이름 | 값 |
| --- | --- |
| `NOTION_TOKEN` | 1번에서 받은 시크릿 |
| `NOTION_DATABASE_ID` | 보드 DB의 ID |

GitHub 접근에는 Actions가 기본 제공하는 `GITHUB_TOKEN`을 쓴다. 공개 레포의 PR만
읽으므로 별도 PAT가 필요 없다.

### 3. `동기화 키` 속성 추가

Notion DB에 rich_text 속성을 하나 만든다. 이름은 `config.yml`에서 바꿀 수 있다.

### 4. 설정 파일

`config.yml`에 감시할 레포와 속성·상태 이름을, `members.yml`에 대상 멤버를 적는다.
아래 "설정" 절을 보라.

### 5. 백필

기존 카드에는 `PR 링크`가 비어 있고 PR 주소가 본문 북마크에만 있을 수 있다.
백필 스크립트가 본문에서 URL을 뽑아 GitHub을 조회하고 `PR 링크`와 `동기화 키`를
채운다. 매칭에 실패한 카드는 목록으로 출력되니 사람이 처리한다.

```
pnpm backfill
```

### 6. dry-run

```
pnpm sync --dry-run
```

어떤 카드가 어디로 옮겨갈지 목록만 뽑는다. **켜기 전에 반드시 한 번 돌려보라.**
새 규칙과 어긋나 있던 카드들이 첫 실행에 한꺼번에 움직인다. 예고 없이 켜면
보드가 멋대로 바뀐 것처럼 보인다. 이 목록을 들고 사람들에게 먼저 알려라.

### 7. cron 켜기

`.github/workflows/sync.yml`의 스케줄 주석을 푼다. 기본 10분.

## 설정

비밀과 설정을 파일로 가른다. CI에서는 `.env`를 커밋할 수 없으니 비밀은 Actions
secret으로 가고 `.env.example`은 "이 키들을 등록하라"는 문서로만 남는다. 반대로
멤버 명단과 속성 매핑은 비밀이 아니고 목록·중첩이 있는 데이터라 레포에 커밋한다.
오히려 공개되어야 리뷰 기록이 남는다.

### `config.yml`

다른 조직은 이 파일만 고치면 된다.

```yaml
upstream: facebook/astryx
forkRepoName: astryx        # <member>/<forkRepoName> 을 fork PR로 인식

notion:
  properties:
    status:  상태
    prUrl:   PR 링크
    syncKey: 동기화 키
    date:    날짜
  status:
    teamReview:       In Team-Review
    maintainerReview: In Maintainer-Review
    merged:           Merged
    closed:           Closed

titleFormat: "[{name}] {title}"
```

어댑터 추상화나 플러그인 구조는 두지 않는다. 두 번째 사용자가 실제로 나타났을 때
그 보드를 보고 정한다.

### `members.yml`

```yaml
members:
  - login: Kyujenius
    # name: 홍규진      # 생략하면 GitHub 프로필 이름을 쓴다
    # notionUserId: 6e6f3595-...   # 있으면 카드 생성 시 담당자로 지정한다
```

Notion 사용자 id 는 워크스페이스 게스트라 users API 에 안 나올 수 있다. 그럴 땐
그 사람이 아무 카드에나 `담당자`를 한 번 지정하게 하고 그 카드의 `담당자` 속성을
API 로 읽으면 id 가 나온다.

GitHub API가 `author.name`으로 실명을 주므로 대개 `login`만 적으면 된다.
프로필 이름이 비었거나 다른 사람만 `name`으로 덮어쓴다.

## 어떻게 동작하나

워크플로우가 세 단계를 순서대로 실행한다.

1. **수집** — GitHub GraphQL에서 대상 PR 목록을 가져온다.
2. **계획** — PR 목록과 카드 목록을 받아 수행할 작업 목록을 만든다. 순수 함수.
3. **반영** — 작업 목록을 Notion API로 실행한다.

계획 단계를 순수 함수로 떼어낸 것이 핵심이다. 네트워크 없이 규칙 전체를 테스트할
수 있고, `--dry-run`이 3단계를 건너뛰는 것만으로 구현된다.

수집은 REST 대신 GraphQL로 한다. REST search 응답에는 head 브랜치 이름이 없어서
PR마다 호출이 한 번씩 더 붙는데, 우리 키가 브랜치명이라 그게 그대로 비용이 된다.

```
is:pr repo:facebook/astryx repo:A/astryx repo:B/astryx author:A author:B
```

GitHub search는 같은 qualifier 반복을 OR로, 서로 다른 qualifier를 AND로 묶는다.

## 제약과 알려진 한계

**webhook을 쓸 수 없다.** PR이 올라가는 `facebook/astryx`는 외부 레포이고 webhook
등록에는 admin 권한이 필요하다. 라벨 부착과 리뷰어 지정도 write 권한을 요구하므로
마찬가지로 불가능하다. 권한 없이 읽을 수 있는 신호는 PR이 향하는 레포, `state`,
`merged_at`, `isDraft` 정도다. 그래서 주기적 폴링이 유일한 수단이고, 이벤트를 받을
서버를 둘 이유가 없어 Actions로 간다.

**GitHub search 쿼리는 256자를 넘을 수 없다.** 멤버 한 명이 `repo:`와 `author:`로
약 35자를 쓰니 한 쿼리에 6~7명이 한계다. 멤버를 청크로 나눠 여러 번 질의하고
합친다. search rate limit이 분당 30회라 수십 명이어도 여유가 있다.

**GitHub search 인덱스는 즉시 일관적이지 않다.** 새 PR이 잡히기까지 1~2분 걸릴 수
있다. 10분 주기에서는 무해하다.

**Actions cron은 정확하지 않다.** 특히 정각 부근에서 지연되고, 레포에 60일간 활동이
없으면 스케줄이 자동 비활성화된다. `workflow_dispatch`를 함께 열어 수동 실행이
가능하게 한다.

**Notion rate limit은 평균 초당 3회다.** 카드가 수십 장 수준이라 순차 처리로
충분하고, 429에는 지수 백오프로 최대 3회 재시도한다. `Notion-Version` 헤더는
명시적으로 고정한다.

## 실패했을 때

**수집 실패는 전부-아니면-전무다.** GraphQL 질의가 하나라도 실패하면 아무것도 쓰지
않고 워크플로우를 실패시킨다. 부분적인 PR 목록으로 계획을 세우면, 존재하는 PR을
못 봤다는 이유로 엉뚱한 카드를 새로 만들게 된다.

**반영 실패는 카드 단위로 독립이다.** 한 카드의 쓰기가 실패해도 나머지를 계속
진행하고, 실패 목록을 로그에 남긴 뒤 워크플로우를 실패로 표시한다. 다음 실행이
같은 작업을 다시 시도한다.

**멱등성.** 같은 입력으로 다시 돌려도 안전하다. 목표 상태가 현재 상태와 같으면
작업을 만들지 않는다.

## 개발

```
src/github.ts       GraphQL 조회, 쿼리 청크 분할
src/notion.ts       조회·생성·갱신
src/plan.ts         순수 함수 — 여기서 TDD로 시작한다
src/plan.test.ts
src/cli.ts          --dry-run
scripts/backfill.ts 일회성
```

`plan()`이 순수 함수이므로 네트워크 없이 규칙 전체를 검증할 수 있다. GitHub·Notion
클라이언트는 얇은 어댑터로 두고 통합 테스트는 하지 않는다. `--dry-run`이 사실상의
통합 확인 수단이다.

## 다른 조직에서 쓰려면

**이 도구는 함수랑의 작업 방식에 맞춰 만들었다.** 특히 "fork main으로 먼저 PR을
쏘고 그다음 upstream으로 쏜다"는 2단계 흐름이 상태 매핑에 그대로 박혀 있다.
upstream에 바로 PR을 쏘는 조직이라면 `In Team-Review` 칸이 영원히 비어 있게 된다.

`config.yml`이 흡수하는 건 이름표까지다 — 속성 이름, 상태 값 이름, 대상 레포,
카드 제목 포맷, 멤버 명단. 단계 구조나 판별 규칙을 바꾸려면 `src/plan.ts`를
고쳐야 한다.

설정으로 모든 조직을 감당하려 들지 않았다. 많이 달라야 하는 쪽은 fork해서 고치는
편이 서로 낫다. 다만 fork-and-configure라 토큰 보관 책임이 각자에게 남으므로
OAuth 서버도 DB도 필요 없다는 점은 그대로다.
