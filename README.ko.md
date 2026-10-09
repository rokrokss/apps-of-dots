<div align="center">
  <img src="brand/out/banner-1400x560.png" alt="apps of dots: 내 앱을 내 dot에 연결" width="100%" />
  <h1>apps of dots</h1>
  <p>내 앱을 OpenAI dot에 연결하는 셀프 호스팅 MCP 모음입니다.</p>
  <p>
    <b>Discord·Telegram·WhatsApp MCP를 내 컴퓨터에서 실행하고, 나만의 Secure MCP Tunnel로
    연결합니다.</b><br />
    나가는 연결만 사용합니다. 공개 서버도, 포트 개방도, ngrok이나 Tailscale Funnel도 필요 없습니다.
  </p>
  <p>
    <a href="https://github.com/rokrokss/apps-of-dots/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rokrokss/apps-of-dots/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-245d47" /></a>
    <img alt="Node.js 24+" src="https://img.shields.io/badge/node-24%2B-6e8c64" />
    <img alt="macOS and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-8aa77e" />
  </p>
  <p>
    <a href="#설치">설치</a> · <a href="#웹에서-설정하기">웹 설정</a> ·
    <a href="discord/README.md">Discord</a> · <a href="telegram/README.md">Telegram</a> ·
    <a href="whatsapp/README.md">WhatsApp</a> · <a href="core/docs/architecture.md">Architecture</a> ·
    <a href="README.md">English</a>
  </p>
</div>

## 소개

[dots](https://openai.com/ko-KR/index/introducing-dots/)는 ChatGPT에서 상시 작동하는 OpenAI의
에이전트이며, 플러그인을 통해 여러 앱에 연결됩니다. apps of dots는 직접 실행하는 앱을 여기에
더합니다. 각 앱은 내 컴퓨터의 로컬 MCP 서버로 실행되고, Secure MCP Tunnel이 공개 서버 없이 지원되는
OpenAI 클라이언트와 연결합니다. 하나의 명령줄과 로컬 설정 화면으로 모두 관리합니다.

| 앱        | 제공 방식                                                                                   |
| --------- | ------------------------------------------------------------------------------------------- |
| Discord   | 이 레포에서 실행. 원본 MCP의 **99개 도구 전체**와 Secure MCP Tunnel 지원                    |
| Telegram  | 이 레포에서 실행. chigwell/telegram-mcp의 **139개 도구**, 개인 계정·터널 지원               |
| WhatsApp  | 이 레포에서 실행. verygoodplugins/whatsapp-mcp의 **17개 도구**, 연결된 기기·터널 지원       |
| KakaoTalk | [기존 프로젝트](https://github.com/rokrokss/kakaotalk-bridge)의 설치 가이드 사용            |
| Recly     | [기존 Events 가이드](https://github.com/rokrokss/recly/blob/main/docs/recly-events.md) 사용 |

Discord는 메시지, 채널, 멤버, 역할, 관리, 포럼, 웹훅, 예약 이벤트, 초대, DM 도구를 모두 제공합니다.
Discord **MCP Events는 구현하지 않습니다**. Discord의 예약 이벤트 관리 도구는 포함됩니다.

## 동작 방식

<p align="center">
  <img src="brand/out/how-it-works.png" alt="앱 계정, 내 컴퓨터의 apps of dots, Secure MCP Tunnel, ChatGPT의 내 dot 순서로 연결" width="100%" />
</p>

계정 정보와 세션은 내 컴퓨터의 비공개 데이터 폴더에 남습니다. 공식 tunnel-client는 OpenAI로 나가는
HTTPS 연결만 만들기 때문에 포트 개방이나 포트 포워딩, 리버스 프록시가 필요 없고 ngrok·Cloudflare
Tunnel·Tailscale Funnel로 외부에 노출할 것도 없습니다. apps of dots가 실행하는 어떤 것도 인터넷에서
직접 접근할 수 없습니다. 이 터널을 ChatGPT에 사용자 지정 MCP 서버로 추가하면 됩니다. 프로세스와 인증
정보 처리는 [아키텍처 문서](core/docs/architecture.md)를 참고하세요.

## 설치

```sh
git clone https://github.com/rokrokss/apps-of-dots.git
cd apps-of-dots
pnpm install --frozen-lockfile
pnpm build
```

| 필요 항목                                                                      | 용도                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Node.js 24 이상, pnpm 10                                                       | 전체                                      |
| [tunnel-client](https://github.com/openai/tunnel-client#install-with-homebrew) | 모든 터널                                 |
| [uv](https://docs.astral.sh/uv/)                                               | Telegram·WhatsApp (Python 3.12 자동 준비) |
| Go 1.26 이상, C 컴파일러                                                       | WhatsApp 브리지                           |

<details>
<summary><strong>macOS: Homebrew로 한 번에 설치</strong></summary>

```sh
xcode-select --install
brew install node pnpm uv go openai/tools/tunnel-client
```

`xcode-select`가 C 컴파일러를 설치합니다.

</details>

<details>
<summary><strong><code>apps-of-dots</code> 명령으로 실행하기</strong></summary>

빌드 후 `pnpm link --global`을 사용하면 `apps-of-dots discord setup`처럼 실행할 수 있습니다. pnpm의
전역 실행 경로가 PATH에 있어야 하고, 이 체크아웃을 유지해야 합니다. 아직 npm에 게시된 패키지는
없습니다.

</details>

<details>
<summary><strong>노트북과 여러 컴퓨터</strong></summary>

- 컴퓨터마다 따로 설정하고 Telegram·WhatsApp은 해당 컴퓨터에서 QR로 로그인하세요. 비공개 데이터
  폴더(macOS는 `~/Library/Application Support/apps-of-dots`)를 복사하지 마세요. 절대 경로와 로컬에서
  빌드한 바이너리가 들어 있고, Telegram 세션을 두 컴퓨터에서 동시에 쓰면 중복 세션 오류가 납니다.
- 터널 ID 하나에는 클라이언트를 하나만 실행합니다. 컴퓨터마다 별도의 터널 ID를 쓰거나 기존 터널을
  먼저 중지하세요.
- 터널을 중지해도 계정 세션은 해제되지 않습니다. 더 이상 쓰지 않는 컴퓨터는 Telegram·WhatsApp 기기
  목록에서 해제하세요.
- 노트북이 잠자기에 들어가면 터널 연결이 끊깁니다. `caffeinate -i`는 실행 중에 유휴 잠자기를 막지만,
  덮개를 닫았을 때의 잠자기는 막지 못합니다.

</details>

## 웹에서 설정하기

[설치](#설치) 후 아래 명령을 실행하면 로컬 설정 화면이 열립니다.

```sh
pnpm apps-of-dots ui
```

<p align="center">
  <img src="brand/out/setup-center.png" alt="Discord, Telegram, WhatsApp이 표시된 로컬 설정 화면" width="100%" />
</p>

Discord·Telegram·WhatsApp의 계정·터널 설정부터 상태 확인·시작·중지·ChatGPT에 추가하는 방법까지
화면에서 안내합니다. Telegram·WhatsApp은 웹에 표시된 QR을 휴대폰으로 스캔하고 승인하면 터널이
시작됩니다. QR은 자동 갱신되며 로그인 취소와 새로고침 후 이어하기도 가능합니다. Telegram의 2단계
비밀번호는 필요한 경우에만 입력하며 해당 로그인에만 사용하고 저장하지 않습니다.

<p align="center">
  <img src="brand/out/telegram-login.png" alt="QR 코드로 Telegram 로그인" width="49%" />
  <img src="brand/out/discord-ready.png" alt="준비된 Discord 터널과 ChatGPT에 추가하는 단계" width="49%" />
</p>

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

## Discord로 시작하기

Discord 봇 토큰, OpenAI 터널 ID와 실행용 키가 필요합니다.

```sh
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
않습니다. Telegram과 WhatsApp의 `setup`은 `uv`로 잠긴 라이브러리 의존성을 설치하고 로컬 WhatsApp
브리지를 빌드합니다([필요 항목](#설치) 참고). 앱별로 별도의 터널 ID를 사용하세요.

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

현재는 첫 구현이며 macOS에서 CLI와 실제 도구 스키마를 검사했습니다. `pnpm test:servers`는 계정
로그인 없이 레포 내부 Python·Go 코드를 빌드하고 원본 도구 스키마와 비교합니다. 실제 계정 인증·OpenAI
터널·dot 연결은 사용자 키로 별도 확인해야 합니다. Linux용 CI 설정은 포함되어 있고, Windows와 부팅
자동 실행은 후속 범위입니다.

## 이미지와 라이선스

README 이미지는 [`brand/`](brand/)의 HTML을 `brand/render.sh`로 렌더링한 것입니다. 이미지 속 dots
아트워크는 [dots 발표](https://openai.com/ko-KR/index/introducing-dots/)에 실린 OpenAI의 저작물이며
이 레포의 라이선스 대상이 아닙니다. 설정 화면 이미지는 예시 연결 상태를 보여줍니다.

MIT 라이선스이며, 가져온 Telegram 소스는 Apache-2.0을 따릅니다. 커뮤니티의 독립 프로젝트로, OpenAI나
연결되는 앱의 공식 제품이 아닙니다.
