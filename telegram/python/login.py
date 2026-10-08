"""Interactive QR login and read-only session validation; never print session keys."""

import asyncio
import getpass
import os
import sys

import qrcode
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

os.umask(0o077)


async def main():
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
            print("Telegram: Settings > Devices > Link Desktop Device. Scan this QR code.")
            for _ in range(5):
                qr = await client.qr_login()
                image = qrcode.QRCode(border=2)
                image.add_data(qr.url)
                image.print_ascii(invert=True)
                try:
                    await qr.wait(timeout=60)
                    break
                except asyncio.TimeoutError:
                    print("QR expired; generating another code.")
                except SessionPasswordNeededError:
                    await client.sign_in(password=getpass.getpass("Telegram two-step password: "))
                    break
            else:
                raise RuntimeError("QR login timed out.")
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram login was not authorized.")
        await client.get_me()
        os.chmod(session + ".session", 0o600)
        print("Telegram account authenticated.")
    finally:
        await client.disconnect()


try:
    asyncio.run(main())
except KeyboardInterrupt:
    sys.exit(130)
except Exception as error:
    # Telethon's diagnostic is useful, but API hash must never appear in output.
    print(str(error).replace(os.environ["TELEGRAM_API_HASH"], "[redacted]"), file=sys.stderr)
    sys.exit(1)
