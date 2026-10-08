# apps-of-dots

내 앱을 OpenAI dot에 연결하는 셀프 호스팅 MCP 모음입니다.

[English](README.md) · [Discord](discord/README.md) · [Telegram](telegram/README.md) ·
[WhatsApp](whatsapp/README.md)

프로젝트의 기본 언어는 영어입니다. 이 문서는 보조 번역이며, 최신 기준은
[영문 README](README.md)입니다.

| 앱        | 제공 방식                                                                                   |
| --------- | ------------------------------------------------------------------------------------------- |
| Discord   | 이 레포에서 실행. 원본 MCP의 **99개 도구 전체**와 Secure MCP Tunnel 지원                    |
| Telegram  | 이 레포에서 실행. chigwell/telegram-mcp의 **139개 도구**, 개인 계정·터널 지원               |
| WhatsApp  | 이 레포에서 실행. verygoodplugins/whatsapp-mcp의 **17개 도구**, 연결된 기기·터널 지원       |
| KakaoTalk | [기존 프로젝트](https://github.com/rokrokss/kakaotalk-bridge)의 설치 가이드 사용            |
| Recly     | [기존 Events 가이드](https://github.com/rokrokss/recly/blob/main/docs/recly-events.md) 사용 |

Discord는 메시지, 채널, 멤버, 역할, 관리, 포럼, 웹훅, 예약 이벤트, 초대, DM 도구를 모두 제공합니다.
Discord **MCP Events는 구현하지 않습니다**. Discord의 예약 이벤트 관리 도구는 포함됩니다.

## 시작하기

Node.js 24 이상, pnpm 10, Discord 봇 토큰, OpenAI 터널 ID와 실행용 키가 필요합니다. Mac에서는 공식
터널 클라이언트를 먼저 설치합니다.

```sh
brew install openai/tools/tunnel-client
git clone https://github.com/rokrokss/apps-of-dots.git
cd apps-of-dots
pnpm install --frozen-lockfile
pnpm build
pnpm apps-of-dots discord setup
pnpm apps-of-dots discord start
pnpm apps-of-dots discord status
```

설정 과정에서 토큰과 키는 숨김 입력으로 받습니다. Discord Developer Portal에서 **Message Content**와
**Server Members** intent를 켜고 봇을 서버에 초대하세요. 도구 99개는 모두 노출되며, 실제 작업 가능
여부는 봇의 Discord 권한과 역할 순서에 따릅니다.

`ready: true`를 확인하면 ChatGPT Plugins에서 **Add custom MCP server → Tunnel**을 선택해 연결합니다.
인증 방식은 **No authentication**을 사용하며, 이 개인 연결은 터널 접근 권한으로 보호됩니다. 목록에
없으면 해당 ChatGPT 워크스페이스와의 연결을 확인하세요. 첫 질문으로 “내 Discord 서버 목록과 채널들을
보여줘”를 해보세요.

## 운영

Discord·Telegram·WhatsApp MCP 구현은 모두 이 레포의 `discord/server`, `telegram/server`,
`whatsapp/server`와 `whatsapp/bridge`에 포함되어 있습니다. 외부 MCP 패키지나 저장소를 받아 실행하지
않습니다. Telegram과 WhatsApp의 `setup`은 `uv`로 잠긴 라이브러리 의존성을 설치하며, 필요한 Python
3.12도 준비합니다. WhatsApp은 로컬 브리지 빌드에 Go 1.26 이상과 C 컴파일러가 필요합니다. 앱별로
별도의 터널 ID를 사용하세요.

```sh
pnpm apps-of-dots telegram setup
pnpm apps-of-dots telegram login
pnpm apps-of-dots telegram start
pnpm apps-of-dots telegram status

pnpm apps-of-dots whatsapp setup
pnpm apps-of-dots whatsapp login
pnpm apps-of-dots whatsapp start
pnpm apps-of-dots whatsapp status
```

Telegram은 `my.telegram.org`의 API ID/hash가 필요합니다. 각 `login`에서 QR을 스캔하며, Telegram의
2단계 비밀번호는 필요한 경우에만 입력하고 저장하지 않습니다. 개인 계정 세션은 비공개 데이터 폴더에
보관합니다. 두 앱 모두 `status`, `stop`, `restart`, `logs`, `doctor`, `tools`, `mcp`를 제공합니다.
WhatsApp은 Go 브리지와 Python MCP를 함께 시작·종료합니다. 선택적인 음성 전사 서비스/모델과 OpenAI
MCP Events 전송은 이 구현에서 설정하지 않습니다.

공통 흐름은 `setup → start → status`이며 Telegram·WhatsApp은 setup 다음에 QR `login`을 합니다. 명령
이름·도움말 순서·설정 완료·시작 대기 안내를 공유합니다. 아래 명령의 `discord`를 다른 앱 이름으로
바꿔 같은 운영 명령을 사용할 수 있습니다.

```sh
pnpm apps-of-dots discord tools
pnpm apps-of-dots discord doctor
pnpm apps-of-dots discord doctor --live
pnpm apps-of-dots discord logs --follow
pnpm apps-of-dots discord restart
pnpm apps-of-dots discord stop
```

`doctor`는 로컬 설정을 검사합니다. 계정까지 확인하는 `doctor --live`의 실행 조건은 다음과 같습니다.
진단 명령이 터널을 자동으로 시작하거나 중지하지는 않습니다.

| 앱       | `doctor --live` 실행 전                                               |
| -------- | --------------------------------------------------------------------- |
| Discord  | 실행·중지 상태 모두 가능. 봇 토큰을 직접 확인합니다.                  |
| Telegram | `telegram stop`으로 중지. 검사 후 `telegram start`로 다시 연결합니다. |
| WhatsApp | `whatsapp start`로 시작. 실행 중인 브리지를 검사합니다.               |

공식 tunnel-client가 백그라운드 프로세스를 관리합니다. 터미널을 닫아도 실행되지만, **재부팅 후에는
`start`를 다시 실행해야 합니다**. 컴퓨터가 꺼지거나 잠들면 연결도 유지되지 않습니다. 중지해도 설정과
키는 보존됩니다.

빌드 후 `pnpm link --global`을 사용하면 `apps-of-dots discord setup`처럼 실행할 수 있습니다. pnpm의
전역 실행 경로가 PATH에 있어야 하고, 이 체크아웃을 유지해야 합니다. 아직 npm에 게시된 패키지는
없습니다.

현재는 첫 구현이며 macOS에서 CLI와 실제 도구 스키마를 검사했습니다. `pnpm test:servers`는 계정
로그인 없이 레포 내부 Python·Go 코드를 빌드하고 원본 도구 스키마와 비교합니다. 실제 계정 인증·OpenAI
터널·dot 연결은 사용자 키로 별도 확인해야 합니다. Linux용 CI 설정은 포함되어 있고, Windows와 부팅
자동 실행은 후속 범위입니다.
