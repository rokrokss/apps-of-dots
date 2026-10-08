"""Converted uploads must remain within the managed bridge's allowed file roots."""

from pathlib import Path

import pytest

import audio


def test_conversion_stays_in_allowed_root(tmp_path, monkeypatch):
    source = tmp_path / "voice.mp3"
    source.write_bytes(b"mp3")
    monkeypatch.setenv("WHATSAPP_MEDIA_ROOTS", str(tmp_path))
    monkeypatch.setattr(audio, "convert_to_opus_ogg", lambda src, dest, *args: Path(dest).write_bytes(b"ogg"))
    converted = Path(audio.convert_to_opus_ogg_temp(str(source)))
    assert converted.parent == tmp_path
    assert converted.read_bytes() == b"ogg"
    assert source.read_bytes() == b"mp3"


@pytest.mark.parametrize("symlink", [False, True])
def test_conversion_rejects_files_outside_roots_before_reading(tmp_path, monkeypatch, symlink):
    root = tmp_path / "files"
    root.mkdir()
    outside = tmp_path / "outside.mp3"
    outside.write_bytes(b"private")
    source = outside
    if symlink:
        source = root / "link.mp3"
        source.symlink_to(outside)
    monkeypatch.setenv("WHATSAPP_MEDIA_ROOTS", str(root))
    monkeypatch.setattr(audio, "convert_to_opus_ogg", lambda *args: pytest.fail("must reject before conversion"))
    with pytest.raises(ValueError, match="outside WHATSAPP_MEDIA_ROOTS"):
        audio.convert_to_opus_ogg_temp(str(source))
    assert list(root.glob("*.ogg")) == []
