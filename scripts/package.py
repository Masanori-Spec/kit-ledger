"""Build a deterministic source + static-app ZIP and source hash manifest.
Run `node scripts/build.mjs` first. No network or external packages.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / "kit-ledger-output"
if output == root or root in output.parents:
    raise SystemExit("Use an output directory outside the source project")
output.mkdir(parents=True, exist_ok=True)
excluded = {"node_modules", "dist", "test-results", "browser-artifacts", ".git", "__pycache__"}
files = sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink() and not (set(p.relative_to(root).parts) & excluded) and p.name != "benchmark-ci.json")
entries = []
for p in files:
    data = p.read_bytes()
    entries.append({"path": p.relative_to(root).as_posix(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "gitBlobSha1": hashlib.sha1(f"blob {len(data)}\0".encode()+data).hexdigest()})
manifest = {"project": "kit-ledger", "version": "0.1.0", "files": entries}
(output / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
stage = output / "source"
if stage.exists():
    shutil.rmtree(stage)
for p in files:
    dest = stage / p.relative_to(root)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(p, dest)
static_files = sorted(p for p in (root / "dist").rglob("*") if p.is_file())
if not static_files:
    raise SystemExit("Build dist/ before packaging")
archive = output / "kit-ledger.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in files + static_files:
        info = zipfile.ZipInfo("kit-ledger/" + p.relative_to(root).as_posix(), date_time=(2026, 10, 3, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, p.read_bytes())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for p in files + static_files:
        assert z.read("kit-ledger/" + p.relative_to(root).as_posix()) == p.read_bytes()
verification = {"archive": archive.name, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "bytes": archive.stat().st_size, "sourceFiles": len(files), "staticFiles": len(static_files), "allArchivedBytesVerified": True}
(output / "archive-verification.json").write_text(json.dumps(verification, indent=2) + "\n")
print(json.dumps(verification, indent=2))
