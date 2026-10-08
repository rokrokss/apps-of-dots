package main

import (
	"encoding/json"
	"os"
	"time"

	"go.mau.fi/whatsmeow"
)

// Only the local UI launcher opts into this inherited pipe. No QR enters logs,
// the REST API or MCP stdout. CLI pairing keeps its terminal renderer.
func webLoginEvents() *os.File {
	if os.Getenv("APPS_OF_DOTS_LOGIN_EVENTS") != "3" {
		return nil
	}
	return os.NewFile(3, "login-events")
}

func writeWebLoginEvent(file *os.File, event whatsmeow.QRChannelItem) {
	if file == nil {
		return
	}
	var payload map[string]interface{}
	switch event.Event {
	case "code":
		payload = map[string]interface{}{"type": "qr", "code": event.Code, "expiresAt": time.Now().Add(event.Timeout).UnixMilli()}
	case "success":
		payload = map[string]interface{}{"type": "scanned"}
	case "timeout":
		payload = map[string]interface{}{"type": "expired"}
	default:
		return
	}
	_ = json.NewEncoder(file).Encode(payload)
}
