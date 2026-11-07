"""Build the complete unsigned add-on for Mozilla signing or development."""
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "extension"
    output = root / "dist" / "Echo.xpi"
    output.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(dir=output.parent, suffix=".xpi", delete=False) as file:
        temporary = Path(file.name)
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
            for file in sorted(source.rglob("*")):
                if file.is_file() and not any(part.startswith(".") for part in file.relative_to(source).parts):
                    archive.write(file, file.relative_to(source))
        with ZipFile(temporary) as archive:
            assert archive.testzip() is None, "Extension archive is corrupt"
            for name in ("manifest.json", "background.js", "sidebar.html", "sidebar.js", "sidebar.css"):
                assert archive.read(name) == (source / name).read_bytes(), f"Missing or stale asset: {name}"
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Packaged {output}")


if __name__ == "__main__":
    main()
