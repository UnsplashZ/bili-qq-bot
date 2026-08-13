import asyncio
import base64
import unittest
from unittest import mock

from src.services.bili_server_core.auth import login as login_service


class _FakePicture:
    content = b"\x89PNG\r\n\x1a\nfixture"


class _FakeQrCodeLogin:
    def __init__(self, _channel):
        self._QrCodeLogin__qr_link = ""
        self._QrCodeLogin__qr_key = ""

    async def generate_qrcode(self):
        self._QrCodeLogin__qr_key = "a" * 32
        self._QrCodeLogin__qr_link = (
            "https://account.bilibili.com/h5/account-h5/auth/scan-web"
            "?navhide=1&qrcode_key=" + self._QrCodeLogin__qr_key
        )

    def get_qrcode_picture(self):
        return _FakePicture()


class LoginQrCodeImageTest(unittest.TestCase):
    def test_login_url_should_return_the_package_generated_png(self):
        with mock.patch.object(login_service.login, "QrCodeLogin", _FakeQrCodeLogin):
            result = asyncio.run(login_service.get_login_url())

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["data"]["key"], "a" * 32)
        self.assertTrue(result["data"]["image"].startswith("data:image/png;base64,"))
        encoded = result["data"]["image"].split(",", 1)[1]
        self.assertEqual(base64.b64decode(encoded), _FakePicture.content)

    def test_login_url_should_reject_a_mismatched_embedded_key(self):
        class MismatchedQrCodeLogin(_FakeQrCodeLogin):
            async def generate_qrcode(self):
                await super().generate_qrcode()
                self._QrCodeLogin__qr_key = "b" * 32

        with mock.patch.object(login_service.login, "QrCodeLogin", MismatchedQrCodeLogin):
            result = asyncio.run(login_service.get_login_url())

        self.assertEqual(result["status"], "error")
        self.assertIn("key mismatch", result["message"])


if __name__ == "__main__":
    unittest.main()
