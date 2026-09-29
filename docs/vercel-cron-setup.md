# Vercel Cron 설정 안내

이 레포에 `vercel.json` 과 `api/sync.ts` 는 이미 커밋돼 있습니다. 코드는 더 손댈
것이 없고, Vercel 콘솔에서 하는 작업만 남았습니다. 아래 순서대로 따라가시면
됩니다. 전부 합쳐 15분쯤 걸립니다.

## 0단계. 플랜 확인 (가장 먼저)

**팀 플랜이 Pro 이상이어야 합니다.**

Hobby 플랜은 cron 실행이 하루 1회로 제한됩니다. `vercel.json` 에 10분 주기로 적어
두어도 Vercel 이 하루 한 번으로 줄여서 실행합니다. 그러면 이 설정을 해도 지금과
달라지는 것이 없습니다.

확인 방법은 Vercel 대시보드 왼쪽 위에서 팀을 고른 뒤 Settings → General 로 들어가면
플랜 이름이 보입니다.

Hobby 로 확인되면 여기서 멈추고 알려주세요. 다른 방법으로 진행하겠습니다.

## 1단계. GitHub 토큰 발급

Vercel 이 GitHub 워크플로를 실행시키려면 토큰이 필요합니다.

아래 주소로 들어갑니다.

```
https://github.com/settings/personal-access-tokens/new
```

입력할 값은 다음과 같습니다.

| 항목 | 값 |
| --- | --- |
| Token name | 아무거나. 예를 들어 `vercel-cron-contrib-board-sync` |
| Resource owner | `hamsurang` |
| Expiration | 원하는 기간. 만료되면 갱신이 필요합니다 |
| Repository access | `Only select repositories` 선택 후 `contrib-board-sync` 하나만 |
| Permissions | `Repository permissions` 를 펼쳐서 **Actions** 항목을 `Read and write` 로 |

Actions 하나만 켜면 됩니다. 나머지는 전부 `No access` 로 두세요. 권한을 이만큼만
주었기 때문에 이 토큰으로 할 수 있는 일은 이 레포의 워크플로를 실행시키는 것이
전부입니다.

`Generate token` 을 누르면 `github_pat_` 로 시작하는 문자열이 한 번만 보입니다.
창을 닫으면 다시 볼 수 없으니 복사해서 잠시 메모장에 두세요.

`hamsurang` 이 조직이라 발급 직후 상태가 `Pending` 으로 남을 수 있습니다. 그럴
때는 조직 Settings → Personal access tokens → Pending requests 에서 승인해야
동작합니다.

## 2단계. CRON_SECRET 만들기

이 엔드포인트는 인터넷에 공개된 주소라서 아무나 호출할 수 있습니다. 그래서 Vercel
이 보낸 요청인지 확인할 암호를 하나 정합니다.

터미널을 열고 아래를 그대로 실행하세요.

```bash
openssl rand -hex 32
```

`3f7a9c...` 처럼 64자리 문자열이 나옵니다. 이것을 복사해 두세요. macOS 와 Linux 는
`openssl` 이 기본 설치돼 있어서 그대로 실행됩니다.

혹시 `openssl: command not found` 가 나오면 Node 로도 만들 수 있습니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

이 값은 어디에 기억해 둘 필요가 없습니다. 다음 단계에서 Vercel 에 붙여넣고 나면
다시 쓸 일은 6단계 검증 때 한 번뿐입니다.

## 3단계. Vercel 프로젝트 만들기

1. Vercel 대시보드에서 `Add New` → `Project` 를 누릅니다.
2. 목록에서 `hamsurang/contrib-board-sync` 를 찾아 `Import` 를 누릅니다.
3. `Framework Preset` 을 `Other` 로 선택합니다.
4. `Build and Output Settings` 를 펼쳐서 `Build Command` 와 `Output Directory` 를
   비워 둡니다. 빌드할 것이 없는 레포입니다.
5. 아직 `Deploy` 를 누르지 마세요. 환경 변수를 먼저 넣습니다.

## 4단계. 환경 변수 두 개 넣기

임포트 화면 아래쪽에 `Environment Variables` 칸이 있습니다. 이미 배포를 눌렀다면
Settings → Environment Variables 로 들어가면 같은 화면이 나옵니다.

두 개를 추가합니다. 둘 다 `Production` 에 체크돼 있어야 합니다.

| Name | Value |
| --- | --- |
| `CRON_SECRET` | 2단계에서 만든 64자리 문자열 |
| `GH_PAT` | 1단계에서 발급한 `github_pat_...` 토큰 |

이름의 대소문자가 정확해야 합니다. 코드가 이 이름 그대로 읽습니다.

## 5단계. 배포

`Deploy` 를 누릅니다. 빌드할 것이 없어서 1분 안에 끝납니다.

배포가 끝나면 Settings → Cron Jobs 로 들어가 보세요. `/api/sync` 항목이 보이고
주기가 `*/10 * * * *` 로 적혀 있으면 정상입니다. 여기서 주기가 다르게 표시되면
0단계의 플랜 제한에 걸린 것입니다.

## 6단계. 실제로 동작하는지 확인

10분을 기다리지 말고 직접 호출해서 확인합니다.

터미널에서 아래 두 줄을 차례로 실행하세요. 첫 줄의 두 값은 본인 것으로 바꿔야
합니다.

```bash
CRON_SECRET=여기에_2단계에서_만든_문자열
PROJECT_URL=https://여기에_배포된_주소.vercel.app
```

프로젝트 주소는 Vercel 프로젝트 화면 맨 위 `Domains` 에 있는 값입니다.

이어서 아래를 실행합니다.

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" "$PROJECT_URL/api/sync"
```

첫 줄에 `HTTP/2 204` 가 나오면 성공입니다. 본문이 비어 있는 것이 정상입니다.

이제 아래 주소를 열어 보세요.

```
https://github.com/hamsurang/contrib-board-sync/actions
```

방금 시각에 `workflow_dispatch` 로 시작된 실행이 하나 보이면 연결이 끝난 것입니다.
그 실행을 눌러 로그를 펼치고 마지막 줄을 확인하세요. `완료.` 로 끝났으면 Notion 에
실제로 반영한 것입니다.

## 응답이 204가 아닐 때

| 응답 | 원인과 조치 |
| --- | --- |
| `401` | `CRON_SECRET` 이 안 맞습니다. Vercel 에 넣은 값과 터미널 변수가 같은지 확인하세요. 값을 바꿨다면 재배포가 필요합니다 |
| `500 GH_PAT is not set` | `GH_PAT` 환경 변수가 없거나 이름 철자가 다릅니다 |
| `502 dispatch failed: 404` | 토큰의 Actions 권한이 없거나 레포 선택이 잘못됐습니다. 1단계를 다시 확인하세요 |
| `502 dispatch failed: 403` | 토큰이 조직 승인 대기 상태입니다. 조직 Settings 에서 승인해 주세요 |
| `404` (Vercel 이 반환) | 배포에 `api/sync.ts` 가 포함되지 않았습니다. 최신 `main` 으로 재배포하세요 |

환경 변수를 고친 뒤에는 반드시 재배포해야 반영됩니다. Deployments 탭에서 맨 위
배포의 점 세 개 메뉴를 눌러 `Redeploy` 를 선택하면 됩니다.

## 참고로 알아 두시면 좋은 것

`sync.yml` 안의 기존 `schedule` 설정은 그대로 두었습니다. Vercel 쪽에 문제가 생겨도
GitHub 이 가끔은 실행해 주는 백업으로 남겨 둔 것입니다. 두 경로가 동시에 실행돼도
문제가 없습니다. 이 sync 는 같은 작업을 여러 번 해도 결과가 같도록 만들어져 있고,
바꿀 것이 없으면 `작업 0건` 으로 조용히 끝납니다.

이 레포를 Vercel 에 연결하면 `main` 에 푸시할 때마다 배포가 한 번씩 돕니다. 배포할
것이 거의 없어 금방 끝나지만 알림이 늘어나는 것이 신경 쓰이면 Settings → Git 에서
자동 배포를 꺼도 됩니다. cron 은 마지막으로 배포된 버전에서 계속 동작합니다.
