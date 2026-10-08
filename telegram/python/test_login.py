"""Offline coverage of the web login protocol; no Telegram account required."""
import asyncio
import datetime
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch


class PasswordHashInvalidError(Exception):
    pass


class SessionPasswordNeededError(Exception):
    pass


telethon = types.ModuleType("telethon")
telethon.TelegramClient = Mock()
errors = types.ModuleType("telethon.errors")
errors.PasswordHashInvalidError = PasswordHashInvalidError
errors.SessionPasswordNeededError = SessionPasswordNeededError
spec = importlib.util.spec_from_file_location("web_login", Path(__file__).with_name("login.py"))
login = importlib.util.module_from_spec(spec)
with patch.dict("sys.modules", {"telethon": telethon, "telethon.errors": errors, "qrcode": Mock()}):
    spec.loader.exec_module(login)


class Events(io.StringIO):
    def close(self):
        self.was_closed = True

    def values(self):
        return [json.loads(line) for line in self.getvalue().splitlines()]


class LoginTests(unittest.IsolatedAsyncioTestCase):
    async def test_password_retry_uses_fresh_challenge_without_emitting_password(self):
        stream = Events()
        client = Mock(sign_in=AsyncMock(side_effect=[PasswordHashInvalidError(), None]))
        async def answer():
            return json.dumps({"requestId": stream.values()[-1]["requestId"], "password": "private-password"}).encode()
        await login.password_login(client, stream, Mock(readline=answer))
        events = stream.values()
        self.assertEqual([event["retry"] for event in events], [False, True])
        self.assertNotEqual(events[0]["requestId"], events[1]["requestId"])
        self.assertNotIn("private-password", stream.getvalue())
        self.assertEqual(client.sign_in.await_count, 2)

    async def test_stale_password_challenge_is_rejected(self):
        client = Mock(sign_in=AsyncMock())
        reader = Mock(readline=AsyncMock(return_value=b'{"requestId":"old","password":"secret"}'))
        with self.assertRaisesRegex(RuntimeError, "Invalid password"):
            await login.password_login(client, Events(), reader)
        client.sign_in.assert_not_awaited()

    async def run_main(self, client, stream, password=None, check=False):
        transport = Mock()
        with (
            patch.object(login, "TelegramClient", return_value=client),
            patch.object(login.sys, "argv", ["login.py", "--check"] if check else ["login.py", "--web"]),
            patch.dict(login.os.environ, {
                "APPS_OF_DOTS_LOGIN_EVENTS": "3", "TELEGRAM_SESSION_NAME": "/fake/account",
                "TELEGRAM_API_ID": "123", "TELEGRAM_API_HASH": "a" * 32,
                "TELEGRAM_DEVICE_MODEL": "test",
            }),
            patch.object(login.os, "fdopen", return_value=stream),
            patch.object(login.os, "chmod") as chmod,
            patch.object(asyncio.get_running_loop(), "connect_read_pipe", AsyncMock(return_value=(transport, None))),
            patch.object(login, "password_login", password or AsyncMock()),
        ):
            await login.main()
        return transport, chmod

    def client(self):
        return Mock(connect=AsyncMock(), disconnect=AsyncMock(), get_me=AsyncMock(),
                    is_user_authorized=AsyncMock(side_effect=[False, True]), qr_login=AsyncMock())

    async def test_expired_qr_rotates_then_two_step_authenticates_and_cleans_up(self):
        client = self.client()
        expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=30)
        client.qr_login.side_effect = [
            Mock(url="tg://first", expires=expires, wait=AsyncMock(side_effect=asyncio.TimeoutError)),
            Mock(url="tg://second", expires=expires, wait=AsyncMock(side_effect=SessionPasswordNeededError)),
        ]
        stream = Events()
        password = AsyncMock()
        transport, chmod = await self.run_main(client, stream, password)
        events = stream.values()
        self.assertEqual([event["type"] for event in events], ["qr", "expired", "qr", "authenticated"])
        self.assertGreater(events[0]["expiresAt"], 0)
        password.assert_awaited_once()
        client.get_me.assert_awaited_once()
        client.disconnect.assert_awaited_once()
        chmod.assert_called_once_with("/fake/account.session", 0o600)
        transport.close.assert_called_once()
        self.assertTrue(stream.was_closed)

    async def test_identity_failure_never_reports_authenticated(self):
        client = self.client()
        client.is_user_authorized.side_effect = [True, True]
        client.get_me.side_effect = RuntimeError("identity unavailable")
        stream = Events()
        with self.assertRaisesRegex(RuntimeError, "identity unavailable"):
            await self.run_main(client, stream)
        self.assertEqual(stream.values(), [])
        client.disconnect.assert_awaited_once()
        self.assertTrue(stream.was_closed)

    async def test_cli_check_does_not_start_qr_login(self):
        client = self.client()
        with self.assertRaisesRegex(RuntimeError, "Session is not authorized"):
            await self.run_main(client, Events(), check=True)
        client.qr_login.assert_not_awaited()
        client.disconnect.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
