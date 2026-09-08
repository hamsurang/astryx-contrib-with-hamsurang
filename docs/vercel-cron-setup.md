# Vercel Cron 설정 (권한 보유자용)

이 레포에 `vercel.json` 과 `api/sync.ts` 는 이미 커밋돼 있습니다. Vercel 콘솔에서
해야 할 일만 아래에 정리했습니다. 코드는 더 건드릴 것이 없습니다.

## 왜 필요한가

`sync.yml` 은 `schedule` 로 돌지만 GitHub 의 스케줄 이벤트는 실행을 보장하지
않습니다. 2026-09-05 ~ 09-07 실측에서 10 분 주기로 설정했을 때 실제 실행 간격이
92 ~ 501 분이었고, 예정 슬롯의 대부분이 통째로 건너뛰어졌습니다. 주기를 시간당으로
낮춰도 4 개 슬롯 중 1 개만 발화했습니다.

그래서 시계를 GitHub 밖으로 옮깁니다. Vercel Cron 이 10 분마다 `/api/sync` 를
호출하고, 그 핸들러가 GitHub 의 `workflow_dispatch` 를 찔러 기존 워크플로를
그대로 실행시킵니다. 워크플로 자체는 수정하지 않았습니다.

## 사전 확인 — 플랜

**팀이 Pro 이상이어야 합니다.** Hobby 플랜은 cron 을 하루 1 회로 제한하므로
`*/10 * * * *` 를 써도 하루 한 번만 실행됩니다. 그 경우 이 방식은 의미가 없으니
설정하지 마시고 알려주세요. 다른 방법으로 갑니다.

배포 후 Settings → Cron Jobs 에서 실제 적용된 빈도를 확인할 수 있습니다.

## 1. 프로젝트 임포트

1. Vercel → Add New → Project
2. `hamsurang/contrib-board-sync` 임포트
3. Framework Preset: **Other**
4. Build Command / Output Directory: **비워 둡니다** (빌드할 것이 없습니다)

## 2. 환경 변수 두 개

Settings → Environment Variables 에서 **Production** 에 추가합니다.

| 이름 | 값 |
| --- | --- |
| `CRON_SECRET` | 임의의 긴 랜덤 문자열 (예: `openssl rand -hex 32`) |
| `GH_PAT` | 아래에서 발급하는 GitHub 토큰 |

`CRON_SECRET` 을 설정해 두면 Vercel 이 cron 호출에 `Authorization: Bearer <값>`
헤더를 붙여 보냅니다. `api/sync.ts` 는 그 헤더가 일치할 때만 동작합니다.
이 엔드포인트는 공개 URL 이므로 이것이 유일한 차단 장치입니다.

## 3. GitHub 토큰 발급

https://github.com/settings/personal-access-tokens/new

| 항목 | 값 |
| --- | --- |
| Resource owner | `hamsurang` |
| Repository access | Only select repositories → `contrib-board-sync` |
| Permissions | Repository permissions → **Actions: Read and write** (이것 하나만) |
| Expiration | 만료일 설정 시 갱신 필요 |

조직 소유 토큰이라 조직 관리자 승인이 필요할 수 있습니다. 발급 후 pending 이면
조직 설정에서 승인해 주세요.

권한을 이 하나로 좁혔기 때문에, 토큰이 유출돼도 할 수 있는 일은 이 레포의
워크플로를 실행시키는 것뿐입니다.

## 4. 배포 후 확인

배포가 끝나면 cron 을 기다리지 말고 직접 호출해 봅니다.

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<프로젝트>.vercel.app/api/sync
```

| 응답 | 의미 |
| --- | --- |
| `204` | 정상. 워크플로가 실행됐습니다 |
| `401` | `CRON_SECRET` 불일치 또는 미설정 |
| `500 GH_PAT is not set` | 환경 변수 누락 |
| `502 dispatch failed: 404` | 토큰 권한 부족 또는 레포 경로 오류 |
| `502 dispatch failed: 403` | 토큰이 조직 승인 대기 상태 |

`204` 를 받았다면
[Actions 탭](https://github.com/hamsurang/contrib-board-sync/actions)에
`workflow_dispatch` 로 시작된 실행이 보입니다. 로그 마지막 줄이 `완료.` 면 Notion
에 실제로 썼다는 뜻이고, `--dry-run 이므로 아무것도 쓰지 않았다` 면 입력이 잘못
전달된 것입니다.

## 알아 둘 것

- **`dryRun` 은 반드시 문자열 `"false"` 로 보냅니다.** 워크플로 입력의 기본값이
  `true` 라, 빼면 계획만 출력하고 Notion 에 아무것도 쓰지 않습니다. 핸들러에
  이미 반영돼 있습니다.
- **sync 는 멱등입니다.** 같은 실행을 여러 번 해도 안전하고, 바꿀 것이 없으면
  `작업 0건` 으로 끝납니다. 그래서 10 분마다 찔러도 부작용이 없습니다.
- **`sync.yml` 의 `schedule` 은 그대로 둡니다.** Vercel 이 죽었을 때의 백업으로
  동작합니다. 두 경로가 동시에 실행돼도 멱등이라 문제가 없습니다.
- 이 레포를 Vercel 에 연결하면 `main` 에 푸시할 때마다 배포가 한 번씩 돕니다.
  배포할 것이 사실상 없어 금방 끝나지만, 알림이 늘어나는 것이 싫다면 Settings →
  Git 에서 자동 배포를 끄고 필요할 때만 수동 배포해도 됩니다.
