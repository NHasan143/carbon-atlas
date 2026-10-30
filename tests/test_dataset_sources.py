"""Tests for source pinning in dataset_sources.py, with the network faked.

Run from the project root:
    python -m pytest tests
"""

import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import dataset_sources as ds  # noqa: E402

OLD, NEW = b"year,value\n2000,1\n", b"year,value\n2000,2\n"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def upstream(monkeypatch):
    """A fake network: maps URL -> bytes, and records every request."""
    served: dict[str, bytes] = {}
    requests: list[str] = []

    def fake_get(url):
        requests.append(url)
        if url.startswith("https://api.github.com/"):
            return json.dumps([{"sha": "c0ffee" * 6 + "abcd",
                                "commit": {"committer": {"date": "2026-10-01T00:00:00Z"}}}]).encode()
        return served[url]

    monkeypatch.setattr(ds, "http_get", fake_get)
    monkeypatch.setattr(ds, "SOURCES", {
        "git": ds.Source(id="git", name="Git source", homepage="https://example.org", license="CC BY 4.0",
                         filename="git.csv", repo="owner/repo", path="data.csv"),
        "plain": ds.Source(id="plain", name="Plain source", homepage="https://example.org", license="CC BY 4.0",
                           filename="plain.csv", url="https://example.org/plain.csv"),
    })
    return served, requests


def write_lock(path, entries):
    path.write_text(json.dumps({"sources": entries}))


def entry(url, data, version=None):
    return {"url": url, "version": version, "sha256": sha(data), "bytes": len(data),
            "retrievedAt": "2026-09-19T19:50:01Z"}


GIT_PINNED = "https://raw.githubusercontent.com/owner/repo/abc123/data.csv"
PLAIN = "https://example.org/plain.csv"


def test_matching_cache_is_used_without_any_download(tmp_path, upstream):
    _, requests = upstream
    lock = tmp_path / "lock.json"
    write_lock(lock, {"git": entry(GIT_PINNED, OLD, "abc123"), "plain": entry(PLAIN, OLD)})
    (tmp_path / "git.csv").write_bytes(OLD)
    (tmp_path / "plain.csv").write_bytes(OLD)
    before = lock.read_text()

    ds.ensure_sources(root=tmp_path, lock_path=lock)

    assert requests == []
    assert lock.read_text() == before


def test_a_changed_cache_stops_the_build(tmp_path, upstream):
    lock = tmp_path / "lock.json"
    write_lock(lock, {"git": entry(GIT_PINNED, OLD, "abc123"), "plain": entry(PLAIN, OLD)})
    (tmp_path / "git.csv").write_bytes(NEW)
    (tmp_path / "plain.csv").write_bytes(OLD)
    with pytest.raises(ds.SourceError, match="git.csv does not match sources.lock.json"):
        ds.ensure_sources(root=tmp_path, lock_path=lock)


def test_missing_cache_is_downloaded_from_the_pinned_version(tmp_path, upstream):
    served, requests = upstream
    served[GIT_PINNED] = OLD
    served[PLAIN] = OLD
    lock = tmp_path / "lock.json"
    write_lock(lock, {"git": entry(GIT_PINNED, OLD, "abc123"), "plain": entry(PLAIN, OLD)})

    ds.ensure_sources(root=tmp_path, lock_path=lock)

    assert requests == [GIT_PINNED, PLAIN]
    assert (tmp_path / "git.csv").read_bytes() == OLD


def test_upstream_that_changed_under_a_pinned_url_is_refused(tmp_path, upstream):
    served, _ = upstream
    served[GIT_PINNED] = OLD
    served[PLAIN] = NEW  # the unversioned URL now serves different bytes
    lock = tmp_path / "lock.json"
    write_lock(lock, {"git": entry(GIT_PINNED, OLD, "abc123"), "plain": entry(PLAIN, OLD)})

    with pytest.raises(ds.SourceError, match="--refresh plain"):
        ds.ensure_sources(root=tmp_path, lock_path=lock)
    assert not (tmp_path / "plain.csv").exists()


def test_refresh_repins_only_the_named_source(tmp_path, upstream):
    served, _ = upstream
    latest = "https://raw.githubusercontent.com/owner/repo/" + "c0ffee" * 6 + "abcd/data.csv"
    served[latest] = NEW
    lock = tmp_path / "lock.json"
    write_lock(lock, {"git": entry(GIT_PINNED, OLD, "abc123"), "plain": entry(PLAIN, OLD)})
    (tmp_path / "git.csv").write_bytes(OLD)
    (tmp_path / "plain.csv").write_bytes(OLD)

    entries = ds.ensure_sources({"git"}, root=tmp_path, lock_path=lock)

    assert entries["git"]["url"] == latest
    assert entries["git"]["version"] == "c0ffee" * 6 + "abcd"
    assert entries["git"]["versionDate"] == "2026-10-01T00:00:00Z"
    assert entries["git"]["sha256"] == sha(NEW)
    assert entries["git"]["retrievedAt"] != "2026-09-19T19:50:01Z"
    assert entries["plain"] == entry(PLAIN, OLD)
    assert json.loads(lock.read_text())["sources"]["git"]["sha256"] == sha(NEW)
    assert (tmp_path / "git.csv").read_bytes() == NEW


def test_unknown_refresh_source_is_rejected(tmp_path, upstream):
    with pytest.raises(ds.SourceError, match="Unknown source"):
        ds.ensure_sources({"nope"}, root=tmp_path, lock_path=tmp_path / "lock.json")


def test_real_lock_pins_every_source_with_a_checksum():
    lock = json.loads(ds.LOCK_PATH.read_text())
    real = ds.SOURCES
    assert set(lock["sources"]) == set(real)
    for sid, pinned in lock["sources"].items():
        assert len(pinned["sha256"]) == 64
        if real[sid].repo:
            # Git-backed sources must point at a commit, never a moving branch.
            assert pinned["version"] and pinned["version"] in pinned["url"]
            assert "/master/" not in pinned["url"] and "/main/" not in pinned["url"]
