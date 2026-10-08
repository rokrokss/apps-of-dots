# apps-of-dots

내 앱을 OpenAI dot에 연결하는 셀프 호스팅 MCP 모음입니다.

[English](README.md) · [Discord 상세 가이드](discord/README.md)

프로젝트의 기본 언어는 영어입니다. 이 문서는 보조 번역이며, 최신 기준은
[영문 README](README.md)입니다.

| 앱        | 제공 방식                                                                                   |
| --------- | ------------------------------------------------------------------------------------------- |
| Discord   | 이 레포에서 실행. 원본 MCP의 **99개 도구 전체**와 Secure MCP Tunnel 지원                    |
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

```sh
pnpm apps-of-dots discord tools
pnpm apps-of-dots discord doctor
pnpm apps-of-dots discord doctor --live
pnpm apps-of-dots discord logs --follow
pnpm apps-of-dots discord restart
pnpm apps-of-dots discord stop
```

공식 tunnel-client가 백그라운드 프로세스를 관리합니다. 터미널을 닫아도 실행되지만, **재부팅 후에는
`start`를 다시 실행해야 합니다**. 컴퓨터가 꺼지거나 잠들면 연결도 유지되지 않습니다. 중지해도 설정과
키는 보존됩니다.

빌드 후 `pnpm link --global`을 사용하면 `apps-of-dots discord setup`처럼 실행할 수 있습니다. pnpm의
전역 실행 경로가 PATH에 있어야 하고, 이 체크아웃을 유지해야 합니다. 아직 npm에 게시된 패키지는
없습니다.

현재는 첫 구현이며 macOS에서 CLI와 실제 stdio 도구 계약을 검사했습니다. 실제 Discord·OpenAI 터널·dot
연결은 사용자 키로 별도 확인해야 합니다. Linux용 CI 설정은 포함되어 있고, Windows와 부팅 자동 실행은
후속 범위입니다.
