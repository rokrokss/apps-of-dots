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

## 웹에서 설정하기

의존성 설치와 빌드 후 아래 명령을 실행하면 로컬 설정 화면이 열립니다.

```sh
pnpm apps-of-dots ui
```

Discord·Telegram·WhatsApp의 계정·터널 설정부터 상태 확인·시작·중지·ChatGPT에 추가하는 방법까지
화면에서 안내합니다. Telegram·WhatsApp은 웹에 표시된 QR을 휴대폰으로 스캔하고 승인하면 터널이
시작됩니다. QR은 자동 갱신되며 로그인 취소와 새로고침 후 이어하기도 가능합니다. Telegram의 2단계
비밀번호는 필요한 경우에만 입력하며 해당 로그인에만 사용하고 저장하지 않습니다.

기존 CLI 설정을 재사용합니다. 저장된 키를 유지하려면 입력란을 비워 두세요. 설정을 바꾸거나 다시
로그인하려면 먼저 해당 터널을 중지합니다. 앱마다 별도의 터널 ID를 사용하세요. CLI도 계속 사용할 수
있으며 KakaoTalk·Recly는 각 프로젝트 가이드로 연결됩니다. 터널 준비 완료가 실제 도구 호출의 성공을
뜻하지는 않으므로, 마지막 화면의 예시 질문을 ChatGPT에서 실행해 확인하세요.

설정 화면은 `127.0.0.1:3210`에서만 열립니다. 터미널에 출력된 링크에는 관리용 접근 토큰이 있으므로
공유하지 마세요. 입력한 키는 기존 CLI와 같은 비공개 파일에 저장되며 웹 응답에 다시 포함되지
않습니다. 설정 작업 중에는 `ui`를 실행한 터미널을 유지하세요. 브라우저를 닫거나 새로고침해도 작업은
계속됩니다. 웹 서버를 종료하면 진행 중인 계정 로그인은 취소되지만 이미 시작한 MCP 터널은 유지됩니다.
컴퓨터를 재부팅하면 터널을 다시 시작해야 합니다.

`ui --no-open`은 브라우저를 열지 않고 링크만 출력하고, `ui --port 0`은 빈 포트를 선택합니다.
`--home /데이터/경로 ui`로 다른 데이터 폴더를 사용할 수 있습니다.

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

Telegram은 `my.telegram.org`의 API ID/hash가 필요합니다. 웹 설정 화면이나 CLI `login`에 표시된 QR을
휴대폰으로 스캔합니다. Telegram의 2단계 비밀번호는 필요한 경우에만 입력하고 저장하지 않습니다. 개인
계정 세션은 비공개 데이터 폴더에 보관합니다. 두 앱 모두 `status`, `stop`, `restart`, `logs`,
`doctor`, `tools`, `mcp`를 제공합니다. WhatsApp은 Go 브리지와 Python MCP를 함께 시작·종료합니다.
선택적인 음성 전사 서비스/모델과 OpenAI MCP Events 전송은 이 구현에서 설정하지 않습니다.

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

## 다른 컴퓨터에서 사용하기

컴퓨터마다 따로 설치해야 합니다. 새 Mac에서는 아래 준비물을 설치한 뒤 위와 같이
클론·빌드·설정합니다. `pnpm apps-of-dots ui`를 쓰는 것이 가장 간단합니다. `xcode-select`는 WhatsApp
브리지 빌드에 필요한 C 컴파일러를 설치합니다.

```sh
xcode-select --install
brew install node pnpm uv go openai/tools/tunnel-client
```

- 비공개 데이터 폴더(macOS는 `~/Library/Application Support/apps-of-dots`)를 복사하지 마세요.
  런타임에 원래 컴퓨터 기준의 절대 경로와 빌드 결과가 들어 있고, Telegram 세션을 두 컴퓨터에서
  동시에 쓰면 중복 세션 오류가 납니다. Telegram·WhatsApp은 새 컴퓨터에서 QR로 다시 로그인하세요.
- 터널 ID 하나에는 클라이언트를 하나만 실행합니다. 기존 컴퓨터의 터널을 먼저 중지하거나, 컴퓨터마다
  별도의 터널 ID를 사용하세요.
- 기존 컴퓨터를 더 이상 쓰지 않으면 Telegram·WhatsApp의 기기 목록에서 그 세션을 해제하세요. 터널을
  중지해도 세션은 해제되지 않습니다.
- 노트북이 잠자기에 들어가면 터널 연결이 끊깁니다. `caffeinate -i`는 실행 중에 유휴 잠자기를 막지만,
  덮개를 닫았을 때의 잠자기는 막지 못합니다.
