"""Build the versioned, deterministic Companion download from tracked source."""
import hashlib
import json
import re
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / "chrome-companion"
manifest = json.loads((source / "manifest.json").read_text())
version = manifest["version"]
assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Invalid extension version"
output = root / "public" / "downloads" / f"talentera-companion-v{version}.zip"
output.parent.mkdir(parents=True, exist_ok=True)
files = [path for path in sorted(source.iterdir()) if path.suffix in {".js", ".html", ".css", ".json", ".md", ".svg"}]
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        entry = zipfile.ZipInfo(f"chrome-companion/{path.name}", date_time=(2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, path.read_bytes())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for path in files:
        assert archive.read(f"chrome-companion/{path.name}") == path.read_bytes()
    for script in re.findall(r'<script src="([^"]+)"', (source / "popup.html").read_text()):
        assert f"chrome-companion/{script}" in archive.namelist()
    for asset in re.findall(r'<(?:img|link)[^>]+(?:src|href)="([^"]+)"', (source / "popup.html").read_text()):
        if not asset.startswith(('http:', 'https:', 'data:')):
            assert f"chrome-companion/{asset}" in archive.namelist(), f"Missing popup asset: {asset}"
print(f"Companion {version}: {len(files)} files, {output.stat().st_size} bytes, SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")
