"""Pinned upstream sources for build_dataset.py.

sources.lock.json records exactly which bytes of each upstream file the
bundled dataset was built from: the upstream commit where the source is a
git repository, and always a SHA-256 checksum, size and retrieval time.

A normal build only ever uses those exact bytes. A cached CSV that no longer
matches the lock stops the build, and a missing one is downloaded again from
its pinned version and checked against the lock. Refreshing (see
`ensure_sources`) is the only way to move to newer upstream data, and it is
the only thing that rewrites the lock, so every data change shows up as a
reviewable diff of that file.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
LOCK_PATH = HERE / "sources.lock.json"
# ourworldindata.org rejects urllib's default user agent.
USER_AGENT = "carbon-atlas-build/1.0"


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    homepage: str
    license: str
    filename: str
    # Git-backed sources are pinned to a commit of `path` in `repo` (GitHub).
    repo: str | None = None
    path: str | None = None
    branch: str = "master"
    # Sources without version history are pinned by checksum alone.
    url: str | None = None

    def download_url(self, version: str | None) -> str:
        if self.repo:
            return f"https://raw.githubusercontent.com/{self.repo}/{version}/{self.path}"
        assert self.url
        return self.url


SOURCES: dict[str, Source] = {
    "co2": Source(
        id="co2",
        name="Our World in Data: CO2 and Greenhouse Gas Emissions",
        homepage="https://github.com/owid/co2-data",
        license="CC BY 4.0",
        filename="co2.csv",
        repo="owid/co2-data",
        path="owid-co2-data.csv",
    ),
    "energy": Source(
        id="energy",
        name="Our World in Data: Energy",
        homepage="https://github.com/owid/energy-data",
        license="CC BY 4.0",
        filename="energy.csv",
        repo="owid/energy-data",
        path="owid-energy-data.csv",
    ),
    # World Bank GDP per capita, PPP (constant 2021 international $), via OWID.
    # It runs to the latest year for ~200 countries, where OWID's co2-data GDP
    # (Maddison Project) stops earlier and covers fewer countries. The grapher
    # export has no version history, so only its checksum can pin it.
    "gdp": Source(
        id="gdp",
        name="World Bank: GDP per capita, PPP (constant 2021 international $), via Our World in Data",
        homepage="https://ourworldindata.org/grapher/gdp-per-capita-worldbank",
        license="CC BY 4.0",
        filename="gdp_worldbank.csv",
        url=("https://ourworldindata.org/grapher/gdp-per-capita-worldbank.csv"
             "?v=1&csvType=full&useColumnShortNames=true"),
    ),
}


class SourceError(RuntimeError):
    """A source could not be matched to, or fetched at, its pinned version."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" in str(exc.reason):
            # Common with the python.org installer on macOS, which ships without
            # a CA bundle until its "Install Certificates" script has been run.
            raise SourceError(
                f"Could not verify the HTTPS certificate for {url}. On macOS with the "
                f"python.org installer, run 'Install Certificates.command' from your "
                f"Python folder in /Applications, or set SSL_CERT_FILE=/etc/ssl/cert.pem."
            ) from exc
        raise SourceError(f"Could not download {url}: {exc.reason}") from exc


def download(url: str, dest: Path) -> tuple[str, int]:
    """Download `url` to `dest` atomically and return its checksum and size."""
    print(f"Downloading {url} -> {dest.name}")
    data = http_get(url)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=f".{dest.name}.")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, dest)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return sha256_file(dest)


def latest_commit(source: Source) -> tuple[str, str]:
    """The newest upstream commit that changed the source file, and its date."""
    api = (f"https://api.github.com/repos/{source.repo}/commits"
           f"?path={source.path}&sha={source.branch}&per_page=1")
    commits = json.loads(http_get(api))
    if not commits:
        raise SourceError(f"{source.repo} has no commits for {source.path}")
    return commits[0]["sha"], commits[0]["commit"]["committer"]["date"]


def read_lock(path: Path = LOCK_PATH) -> dict:
    if not path.exists():
        return {"sources": {}}
    return json.loads(path.read_text())


def write_lock(lock: dict, path: Path = LOCK_PATH) -> None:
    path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n")


def _refresh(source: Source, dest: Path) -> dict:
    version, version_date = latest_commit(source) if source.repo else (None, None)
    url = source.download_url(version)
    sha256, size = download(url, dest)
    return {
        "name": source.name,
        "homepage": source.homepage,
        "license": source.license,
        "url": url,
        "version": version,
        "versionDate": version_date,
        "sha256": sha256,
        "bytes": size,
        "retrievedAt": utc_now(),
    }


def _use_pinned(source: Source, entry: dict, dest: Path) -> None:
    if dest.exists():
        sha256, _ = sha256_file(dest)
        if sha256 != entry["sha256"]:
            raise SourceError(
                f"{dest.name} does not match sources.lock.json "
                f"(expected sha256 {entry['sha256'][:12]}…, found {sha256[:12]}…). "
                f"Delete it to download the pinned version again, or run "
                f"`python build_dataset.py --refresh {source.id}` to move to the latest upstream data."
            )
        return
    sha256, _ = download(entry["url"], dest)
    if sha256 != entry["sha256"]:
        dest.unlink(missing_ok=True)
        raise SourceError(
            f"The upstream {source.id} source no longer serves the pinned version "
            f"(expected sha256 {entry['sha256'][:12]}…, got {sha256[:12]}…). Run "
            f"`python build_dataset.py --refresh {source.id}` to adopt the current upstream data, "
            f"then review the dataset diff."
        )


def ensure_sources(refresh: set[str] | None = None, *, root: Path = HERE,
                   lock_path: Path = LOCK_PATH) -> dict[str, dict]:
    """Make every source's CSV available locally at its locked version.

    Sources named in `refresh`, and any source the lock does not know yet,
    are fetched from the latest upstream version and re-pinned. Returns the
    lock entry for each source, keyed by source id.
    """
    refresh = refresh or set()
    unknown = refresh - SOURCES.keys()
    if unknown:
        raise SourceError(f"Unknown source(s): {', '.join(sorted(unknown))}")

    lock = read_lock(lock_path)
    entries = lock.setdefault("sources", {})
    changed = False
    for source in SOURCES.values():
        dest = root / source.filename
        entry = entries.get(source.id)
        if source.id in refresh or entry is None:
            entries[source.id] = _refresh(source, dest)
            changed = True
        else:
            _use_pinned(source, entry, dest)
    if changed:
        write_lock(lock, lock_path)
    return {sid: entries[sid] for sid in SOURCES}


def local_path(source_id: str, root: Path = HERE) -> Path:
    return root / SOURCES[source_id].filename
