#!/usr/bin/env python3
"""BETAMOVE — Fotos & PNGs aus assets-min/ auf Web-taugliche Größe bringen.

Die hochgeladenen Fotos kommen direkt von der Kamera/vom Handy (oft
3000-5000px Kantenlänge, mehrere MB) und auch ein paar Partner-Logos als
PNG sind weit größer als nötig (bis zu ~9800px breit, angezeigt werden sie
alle mit height:90px). Angezeigt wird auf der Seite nirgends breiter als
~1160px (siehe css: width:min(1160px,...)). Dieses Script verkleinert jedes
Bild auf eine Web-taugliche Kantenlänge und komprimiert es neu — das
reduziert die Dateigröße massiv, ohne dass auf dem Bildschirm ein
sichtbarer Unterschied entsteht. Als Nebeneffekt werden dabei bei JPEGs
auch EXIF/IPTC/XMP-Metadaten entfernt (wie scripts/bild-metadaten-
entfernen.py), weil Pillow beim Neuspeichern keine Metadaten mitschreibt.

Verwendung:
  python3 scripts/bilder-komprimieren.py                  # alle JPG/PNG in assets-min/
  python3 scripts/bilder-komprimieren.py assets-min/foo.jpg assets-min/bar.png
"""
import io
import sys
from pathlib import Path

from PIL import Image, ImageOps

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets-min"
PHOTO_MAX_EDGE = 1920   # px, deutlich über der größten Fotodarstellung (1160px) für Retina
LOGO_MAX_EDGE = 900     # px, für Logos/Icons (PNG), die nirgends höher als ~90px angezeigt werden
JPEG_QUALITY = 82
# Diagramm wird wie ein Foto in voller Breite gezeigt (ausbildung.html,
# konto-weg.html), nicht wie die übrigen PNGs als kleines Logo.
PNG_PHOTO_LIKE = {"ausbildungskonzept.png"}
# Unter dieser Dateigröße lohnt sich ein erneutes Komprimieren kaum und wird
# übersprungen, außer das Bild ist trotzdem größer als sein Max-Edge.
SKIP_IF_SMALLER_THAN = 100_000


def process(path: Path) -> None:
    before = path.stat().st_size
    is_png = path.suffix.lower() == ".png"
    max_edge = PHOTO_MAX_EDGE if (not is_png or path.name in PNG_PHOTO_LIKE) else LOGO_MAX_EDGE

    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)  # Rotation aus EXIF ins Bild einbacken, bevor EXIF wegfällt
        w, h = im.size
        if max(w, h) <= max_edge and before <= SKIP_IF_SMALLER_THAN:
            print(f"  {path.name}: schon klein genug ({before // 1024} KB, {w}x{h}) — übersprungen")
            return
        if max(w, h) > max_edge:
            scale = max_edge / max(w, h)
            im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

        buf = io.BytesIO()
        if is_png:
            if im.mode == "P":
                im = im.convert("RGBA")
            im.save(buf, "PNG", optimize=True)
        else:
            if im.mode in ("RGBA", "P"):
                im = im.convert("RGB")
            im.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
        new_size = im.size

    # Nie eine Datei vergrößern — bei schon gut komprimierten/kleinen
    # Quellen (z.B. manche PNG-Logos) kann Pillows Re-Encoding größer werden
    # als das Original; dann lieber unverändert lassen.
    after = len(buf.getvalue())
    if after >= before:
        print(f"  {path.name}: Neukodierung wäre größer ({before // 1024} KB -> {after // 1024} KB) — unverändert gelassen")
        return
    path.write_bytes(buf.getvalue())
    pct = round(100 * (1 - after / before))
    print(f"  {path.name}: {before // 1024} KB -> {after // 1024} KB (-{pct}%), {w}x{h} -> {new_size[0]}x{new_size[1]}")


def main() -> None:
    args = sys.argv[1:]
    if args:
        paths = [Path(a) for a in args]
    else:
        paths = sorted(ASSETS_DIR.glob("*.jpg")) + sorted(ASSETS_DIR.glob("*.jpeg")) + sorted(ASSETS_DIR.glob("*.png"))
    if not paths:
        print("Keine Bilder gefunden.")
        return
    print(f"Verarbeite {len(paths)} Bild(er)...")
    for p in paths:
        try:
            process(p)
        except Exception as e:
            print(f"  {p.name}: FEHLER ({e})")


if __name__ == "__main__":
    main()
