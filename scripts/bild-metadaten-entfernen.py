#!/usr/bin/env python3
"""Entfernt personenbezogene Metadaten (EXIF inkl. GPS, XMP, IPTC, Kommentare)
verlustfrei aus JPEG- und PNG-Dateien — die Bilddaten selbst bleiben unverändert.

Datenschutz-Hintergrund: Fotos vom Handy/der Kamera enthalten oft GPS-Koordinaten
(z. B. Wohnort), Gerätedaten, Aufnahmezeit, Namen von Fotograf*innen oder
Canva-Konto-IDs. Das gehört nicht auf eine öffentliche Website.

Aufruf:  python3 scripts/bild-metadaten-entfernen.py assets-min/*.jpg assets-min/*.png
Prüfen:  python3 scripts/datenschutz-check.py
"""
import struct
import sys

# JPEG: diese APPn-Segmente bleiben erhalten, alles andere (APP1 Exif/XMP,
# APP13 IPTC/Photoshop, COM, ...) wird entfernt.
#   APP0  = JFIF-Header, APP2 = ICC-Farbprofil (sonst falsche Farben),
#   APP14 = Adobe-Farbtransformation (für CMYK-JPEGs nötig)
KEEP_APP = {0xE0, 0xE2, 0xEE}
# PNG: diese Text-/Metadaten-Chunks werden entfernt
DROP_PNG = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}


def jpeg_orientation(data):
    """Liefert den EXIF-Orientation-Wert (1 = normal) oder None."""
    i = data.find(b"Exif\x00\x00")
    if i < 0:
        return None
    t = data[i + 6:]
    endian = "<" if t[:2] == b"II" else ">"
    try:
        ifd = struct.unpack(endian + "I", t[4:8])[0]
        n = struct.unpack(endian + "H", t[ifd:ifd + 2])[0]
        for k in range(n):
            e = t[ifd + 2 + 12 * k: ifd + 14 + 12 * k]
            if struct.unpack(endian + "H", e[:2])[0] == 0x0112:
                return struct.unpack(endian + "H", e[8:10])[0]
    except struct.error:
        return None
    return None


def strip_jpeg(data):
    if data[:2] != b"\xff\xd8":
        raise ValueError("kein JPEG")
    out = bytearray(b"\xff\xd8")
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            raise ValueError("unerwartete Daten an Position %d" % i)
        marker = data[i + 1]
        if marker == 0xFF:  # Füllbyte
            i += 1
            continue
        if marker == 0xDA:  # Start of Scan — Rest (Bilddaten) unverändert übernehmen
            out += data[i:]
            return bytes(out)
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i:i + 2 + length]
        is_app = 0xE0 <= marker <= 0xEF
        if (is_app and marker not in KEEP_APP) or marker == 0xFE:
            pass  # Metadaten-Segment verwerfen
        else:
            out += seg
        i += 2 + length
    raise ValueError("kein Start-of-Scan gefunden")


def strip_png(data):
    sig = b"\x89PNG\r\n\x1a\n"
    if data[:8] != sig:
        raise ValueError("kein PNG")
    out = bytearray(sig)
    i = 8
    while i < len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        ctype = data[i + 4:i + 8]
        chunk = data[i:i + 12 + length]
        if ctype not in DROP_PNG:
            out += chunk
        i += 12 + length
        if ctype == b"IEND":
            break
    return bytes(out)


def main(paths):
    rc = 0
    for p in paths:
        data = open(p, "rb").read()
        low = p.lower()
        try:
            if low.endswith((".jpg", ".jpeg")):
                o = jpeg_orientation(data)
                if o not in (None, 1):
                    print(f"ÜBERSPRUNGEN {p}: EXIF-Drehung {o} — Bild erst gerade speichern, sonst steht es nach dem Entfernen schief")
                    rc = 1
                    continue
                new = strip_jpeg(data)
            elif low.endswith(".png"):
                new = strip_png(data)
            else:
                continue
        except ValueError as e:
            print(f"FEHLER {p}: {e}")
            rc = 1
            continue
        if new != data:
            open(p, "wb").write(new)
            print(f"bereinigt {p}: {len(data) - len(new)} Bytes Metadaten entfernt")
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
