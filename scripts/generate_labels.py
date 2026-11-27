#!/usr/bin/env python3
"""
Hromadný generátor tiskových PDF etiket pro Vinařství Salajka (Python alternativa).
Vyžaduje: pip install segno weasyprint
Volitelně: Ghostscript (gs / gswin64c) pro konverzi do CMYK PDF/X-4.

Použití:
  python scripts/generate_labels.py
  python scripts/generate_labels.py --shadow off --cmyk-gs
"""

import argparse
import csv
import html
import io
import re
import shutil
import subprocess
from pathlib import Path

import segno
from weasyprint import HTML


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT_DIR / "data" / "odrudy.csv"
TEMPLATE_PATH = ROOT_DIR / "templates" / "etiketa_template.html"
LOGO_SVG_PATH = ROOT_DIR / "assets" / "logo_salajka_layers.svg"
GLASS_SVG_PATH = ROOT_DIR / "assets" / "znak_vina_cr.svg"
OUT_DIR = ROOT_DIR / "output"


def make_qr_svg(url: str) -> str:
    """Vygeneruje čistý vektorový QR kód (SVG) s korekcí chyb M."""
    qr = segno.make(url, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", xmldecl=False, border=2, dark="#000000", light="#FFFFFF")
    return buf.getvalue().decode("utf-8")


def split_alcohol(value: str) -> tuple[str, str]:
    m = re.match(r"^([0-9]+(?:[,\.][0-9]+)?\s*%)\s*(.*)$", value.strip())
    return (m.group(1), m.group(2)) if m else (value.strip(), "")


def strip_xml_decl(svg: str) -> str:
    return re.sub(r"<\?xml[^>]*\?>\s*", "", svg)


def render_html(template: str, row: dict, logo_svg: str, glass_svg: str, mode: str, shadow: str) -> str:
    alc_num, alc_unit = split_alcohol(row["alkohol"])
    qr_svg = make_qr_svg(row["url_e_etiketa"]) if mode != "spot" else ""
    layer_label = {
        "cmyk": "CMYK + Stin" if shadow == "on" else "CMYK (bez stinu)",
        "spot": "Spot_UV / Embossing (100% M)",
        "preview": "NAHLED (CMYK + Spot_UV)",
    }[mode]

    replacements = {
        "{{KOD}}": html.escape(row["kod"]),
        "{{ODRUDY_NAZEV}}": html.escape(row["odrudy_nazev"]),
        "{{ZATRID_CUKR}}": html.escape(row["zatrid_cukr"]),
        "{{ZATRID_KRATKE}}": html.escape(row["zatrid_kratke"]),
        "{{ROCNIK}}": html.escape(row["rocnik"]),
        "{{VINICNI_TRAT}}": html.escape(row["vinicni_trat"]),
        "{{CISLO_SARZE}}": html.escape(row["cislo_sarze"]),
        "{{ENERGETICKA_HODNOTA}}": html.escape(row["energeticka_hodnota"]),
        "{{ALKOHOL_CISLO}}": html.escape(alc_num),
        "{{ALKOHOL_JEDNOTKA}}": html.escape(alc_unit),
        "{{OBJEM}}": html.escape(row["objem"]),
        "{{OBSAHUJE}}": html.escape(row["obsahuje"]),
        "{{URL_E_ETIKETA}}": html.escape(row["url_e_etiketa"]),
        "{{RENDER_MODE}}": mode,
        "{{SHADOW_MODE}}": shadow,
        "{{LAYER_LABEL}}": html.escape(layer_label),
        "{{LOGO_SVG_INLINE}}": strip_xml_decl(logo_svg),
        "{{WINE_GLASS_SVG_INLINE}}": strip_xml_decl(glass_svg),
        "{{QR_SVG_INLINE}}": qr_svg,
        "{{QR_JS_INLINE}}": "",
    }
    out = template
    for k, v in replacements.items():
        out = out.replace(k, v)
    return out


def convert_to_cmyk_with_gs(src_pdf: Path, dst_pdf: Path) -> None:
    """Volitelná konverze PDF do DeviceCMYK přes Ghostscript (vyžaduje gs/gswin64c v PATH)."""
    gs_exe = shutil.which("gs") or shutil.which("gswin64c")
    if not gs_exe:
        raise RuntimeError("Ghostscript nebyl nalezen v PATH.")
    cmd = [
        gs_exe,
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-sDEVICE=pdfwrite",
        "-sColorConversionStrategy=CMYK",
        "-dProcessColorModel=/DeviceCMYK",
        "-dCompatibilityLevel=1.4",
        f"-sOutputFile={dst_pdf}",
        str(src_pdf),
    ]
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generátor tiskových etiket Vinařství Salajka")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Cesta k CSV souboru")
    parser.add_argument("--shadow", choices=["on", "off"], default="on", help="Volitelná vrstva stínu")
    parser.add_argument("--cmyk-gs", action="store_true", help="Převést výstupní PDF do CMYK pomocí Ghostscript")
    args = parser.parse_args()

    spot_dir = OUT_DIR / "spot"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    spot_dir.mkdir(parents=True, exist_ok=True)

    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    logo_svg = LOGO_SVG_PATH.read_text(encoding="utf-8")
    glass_svg = GLASS_SVG_PATH.read_text(encoding="utf-8")

    with args.csv.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))

    for row in rows:
        code = row["kod"].strip()
        cmyk_html = render_html(template, row, logo_svg, glass_svg, "cmyk", args.shadow)
        cmyk_pdf = OUT_DIR / f"{code}_tisk.pdf"
        HTML(string=cmyk_html, base_url=str(ROOT_DIR)).write_pdf(str(cmyk_pdf))

        if args.cmyk_gs:
            cmyk_conv = OUT_DIR / f"{code}_tisk_CMYK.pdf"
            convert_to_cmyk_with_gs(cmyk_pdf, cmyk_conv)

        spot_html = render_html(template, row, logo_svg, glass_svg, "spot", "off")
        spot_pdf = spot_dir / f"{code}_Spot_UV_Embossing.pdf"
        HTML(string=spot_html, base_url=str(ROOT_DIR)).write_pdf(str(spot_pdf))

        print(f"[OK] {code} -> {cmyk_pdf.name} + spot/{spot_pdf.name}")


if __name__ == "__main__":
    main()
