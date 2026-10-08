package main

import (
	"encoding/json"
	"io"
	"os"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
)

func TestWebLoginEventsFollowEveryRotationAndScan(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	channel := make(chan whatsmeow.QRChannelItem, 3)
	channel <- whatsmeow.QRChannelItem{Event: "code", Code: "first-private-code", Timeout: 20 * time.Second}
	channel <- whatsmeow.QRChannelItem{Event: "code", Code: "rotated-private-code", Timeout: 20 * time.Second}
	channel <- whatsmeow.QRChannelItem{Event: "success"}
	close(channel)
	before := time.Now().UnixMilli()
	outcome := renderPairingQRCodes(channel, io.Discard, func(string, io.Writer) {}, func(event whatsmeow.QRChannelItem) {
		writeWebLoginEvent(writer, event)
	})
	if outcome != pairingQRSucceeded {
		t.Fatalf("outcome = %v", outcome)
	}
	decoder := json.NewDecoder(reader)
	for _, code := range []string{"first-private-code", "rotated-private-code"} {
		var event struct {
			Type, Code string
			ExpiresAt  int64
		}
		if err := decoder.Decode(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type != "qr" || event.Code != code || event.ExpiresAt < before+20000 || event.ExpiresAt > time.Now().UnixMilli()+20000 {
			t.Fatalf("unexpected QR event: %+v", event)
		}
	}
	var scanned map[string]interface{}
	if err := decoder.Decode(&scanned); err != nil {
		t.Fatal(err)
	}
	if scanned["type"] != "scanned" || len(scanned) != 1 {
		t.Fatalf("unexpected scan event: %v", scanned)
	}
}

func TestWebLoginExpiryAndOptIn(t *testing.T) {
	t.Setenv("APPS_OF_DOTS_LOGIN_EVENTS", "")
	if webLoginEvents() != nil {
		t.Fatal("terminal login must not open a web event pipe")
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	writeWebLoginEvent(writer, whatsmeow.QRChannelItem{Event: "timeout"})
	var event map[string]interface{}
	if err := json.NewDecoder(reader).Decode(&event); err != nil {
		t.Fatal(err)
	}
	if event["type"] != "expired" || len(event) != 1 {
		t.Fatalf("unexpected expiry: %v", event)
	}
}
