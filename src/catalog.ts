export const integrations = [
  {
    id: "discord",
    name: "Discord",
    kind: "built-in",
    tools: 99,
    events: false,
    guide: "discord/README.md",
  },
  {
    id: "telegram",
    name: "Telegram",
    kind: "built-in",
    tools: 139,
    events: false,
    guide: "telegram/README.md",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    kind: "built-in",
    tools: 17,
    events: false,
    guide: "whatsapp/README.md",
  },
  {
    id: "kakaotalk",
    name: "KakaoTalk Bridge",
    kind: "external",
    guide: "https://github.com/rokrokss/kakaotalk-bridge",
  },
  {
    id: "recly",
    name: "Recly Events",
    kind: "external",
    guide: "https://github.com/rokrokss/recly/blob/main/docs/recly-events.md",
  },
] as const;
