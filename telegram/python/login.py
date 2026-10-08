"""QR login for the terminal or local web UI; never print session keys."""

import asyncio
import getpass
import json
import os
import sys
import time
import uuid

import qrcode
from telethon import TelegramClient
from telethon.errors import PasswordHashInvalidError, SessionPasswordNeededError

os.umask(0o077)


def emit(stream, event):
    if stream is not None:
        stream.write(json.dumps(event) + "\n")
        stream.flush()


async def password_login(client, stream, reader):
    for attempt in range(3):
        if stream is None:
            password = getpass.getpass("Telegram two-step password: ")
        else:
            request_id = uuid.uuid4().hex
            emit(stream, {"type": "password", "requestId": request_id, "retry": attempt > 0})
            line = await asyncio.wait_for(reader.readline(), timeout=120)
            answer = json.loads(line)
            if answer.get("requestId") != request_id or not isinstance(answer.get("password"), str):
                raise RuntimeError("Invalid password response.")
            password = answer.pop("password")
            if not password or len(password) > 1024:
                raise RuntimeError("Invalid password response.")
        try:
            await client.sign_in(password=password)
            return
        except PasswordHashInvalidError:
            if stream is None:
                print("Incorrect two-step password. Try again.")
        finally:
            password = None
    raise RuntimeError("Two-step password was not accepted.")


async def main():
    web = "--web" in sys.argv
    stream = None
    transport = None
    reader = None
    if web:
        if os.environ.get("APPS_OF_DOTS_LOGIN_EVENTS") != "3":
            raise RuntimeError("Web login requires a private event pipe.")
        stream = os.fdopen(3, "w", buffering=1, closefd=False)
        reader = asyncio.StreamReader(limit=8192)
        transport, _ = await asyncio.get_running_loop().connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
        )
    session = os.environ["TELEGRAM_SESSION_NAME"]
    client = TelegramClient(
        session,
        int(os.environ["TELEGRAM_API_ID"]),
        os.environ["TELEGRAM_API_HASH"],
        device_model=os.environ["TELEGRAM_DEVICE_MODEL"],
    )
    try:
        await client.connect()
        if not await client.is_user_authorized():
            if "--check" in sys.argv:
                raise RuntimeError("Session is not authorized. Run apps-of-dots telegram login.")
            if not web:
                print("Telegram: Settings > Devices > Link Desktop Device. Scan this QR code.")
            for _ in range(5):
                qr = await client.qr_login()
                expires = min(qr.expires.timestamp(), time.time() + 60)
                if web:
                    emit(stream, {"type": "qr", "code": qr.url, "expiresAt": int(expires * 1000)})
                else:
                    image = qrcode.QRCode(border=2)
                    image.add_data(qr.url)
                    image.print_ascii(invert=True)
                try:
                    await qr.wait(timeout=max(0.1, expires - time.time()))
                    emit(stream, {"type": "scanned"})
                    break
                except asyncio.TimeoutError:
                    emit(stream, {"type": "expired"})
                    if not web:
                        print("QR expired; generating another code.")
                except SessionPasswordNeededError:
                    await password_login(client, stream, reader)
                    break
            else:
                raise RuntimeError("QR login timed out.")
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram login was not authorized.")
        await client.get_me()
        os.chmod(session + ".session", 0o600)
        emit(stream, {"type": "authenticated"})
        if not web:
            print("Telegram account authenticated.")
    finally:
        try:
            await client.disconnect()
        finally:
            if transport is not None:
                transport.close()
            if stream is not None:
                stream.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        if "--web" not in sys.argv:
            print(str(error).replace(os.environ["TELEGRAM_API_HASH"], "[redacted]"), file=sys.stderr)
        sys.exit(1)
