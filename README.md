# Vinařství Salajka — Tiskový a datově řízený systém pro etikety

Kompletní pracovní postup, vektorová šablona a automatický generátor tiskových PDF etiket z CSV dat.

---

## 1. Analýza zdrojového PDF (`02 RB 2026.pdf`)

Technická inspekce původního souboru odhalila následující parametry a nedostatky:

| Parametr | Původní stav (`02 RB 2026.pdf`) | Nová šablona (Print-ready) |
|---|---|---|
| **Čistý formát (TrimBox)** | `150 × 95 mm` (`425.197 × 269.291 pt`) | `150 × 95 mm` (zachováno přesně) |
| **Spadávka (Bleed) a ořezky** | **Chybí** (`BleedBox = TrimBox`, bez ořezek) | **3 mm spadávka** (`156 × 101 mm`) + ořezové značky (`168 × 113 mm`) |
| **Písma (Typografie)** | **4 roztříštěné rodiny** (`ITC Legacy Sans`, `Century Gothic`, `Adobe Garamond Pro`, `Sakkal Majalla Bold`) | **2 sjednocená písma** s plnou českou diakritikou (patkové `Georgia` + bezpatkové `Bahnschrift`) |
| **Grafika a QR kód** | 3 rastrové bitmapy (vč. 896×897 px bitmapy QR kódu) | **100 % vektorové SVG** (logo, ornament, znak Víno z ČR i dynamický QR kód) |
| **Vrstvy a „duchové“** | 8 duplicitních OCG vrstev (`Podklad`/`TEXT`) se skrytým starým textem *Cabernet Moravia 2023* | Čisté 3 vrstvy: `01_CMYK_Zaklad`, `02_Stinovani_Volitelne`, `03_Spot_UV_Embossing` |
| **Parciální lak / reliéf** | **0 spotových barev** | Samostatná technická vrstva `Spot_UV` / `Embossing` (100 % Magenta) |

---

## 2. Architektura složek projektu

```text
etikety/
├── 02 RB 2026.pdf                        # Původní referenční PDF
├── README.md                             # Tento návod a tisková specifikace
├── data/
│   └── odrudy.csv                        # Datový zdroj (UTF-8, oddělovač středník ';')
├── assets/
│   ├── logo_salajka_layers.svg           # Vektorové logo, monogram „S“ a ornament ve 3 vrstvách
│   └── znak_vina_cr.svg                  # Vektorový znak Víno z České republiky
├── templates/
│   └── etiketa_template.html             # Tisková HTML+CSS+SVG šablona se 3 mm spadávkou a ořezkami
├── scripts/
│   ├── generate_labels.ps1               # Hromadný generátor pro Windows (bez nutnosti instalace Pythonu)
│   ├── generate_labels.py                # Multiplatformní Python generátor (segno + WeasyPrint + volitelně GS CMYK)
│   ├── qr_svg.js                         # Offline generátor ostrého vektorového QR kódu (ISO/IEC 18004)
│   └── illustrator_prepare_spot.jsx      # ExtendScript pro Adobe Illustrator (Spot_UV + Overprint + PDF/X-4)
└── output/
    ├── 01_RB_2026_tisk.pdf               # Vygenerovaná tisková PDF pro jednotlivé odrůdy
    ├── 02_RV_2026_tisk.pdf
    ├── 03_CM_2025_tisk.pdf
    ├── spot/                             # Samostatné separace technické vrstvy (100% Magenta)
    └── preview/                          # Kontrolní HTML náhledy (CMYK + poloprůhledný Spot_UV + čistý ořez)
```

---

## 3. Jak generovat nové odrůdy (Hromadné generování)

### Krok A: Upravit `data/odrudy.csv`
Otevřete `data/odrudy.csv` (v Excelu nebo textovém editoru v kódování **UTF-8**, oddělovač `;`) a přidejte řádky pro nové odrůdy:
- `kod` — unikátní kód pro název výstupního souboru (např. `04_PG_2026`)
- `odrudy_nazev` — název odrůdy (např. `Rulandské šedé`)
- `zatrid_cukr` — zatřídění + zbytkový cukr pro přední stranu (`Moravské zemské víno • polosladké`)
- `zatrid_kratke` — zatřídění pro zadní/boční část (`Moravské zemské víno`)
- `rocnik` — ročník (`2026`)
- `vinicni_trat` — název viniční trati (`Staré hory`)
- `cislo_sarze` — číslo šarže (`2618`)
- `energeticka_hodnota` — energetická hodnota (`342 kJ / 82 kcal ve 100ml`)
- `alkohol` — obsah alkoholu (`12,0 % obj.`)
- `objem` — objem lahve (`0,75 l`)
- `obsahuje` — alergeny (`Obsahuje oxid siřičitý`)
- `url_e_etiketa` — URL adresa e-etikety (automaticky se převede na ostrý vektorový QR kód)

### Krok B: Spustit generátor

**Varianta 1 — Windows (okamžitě bez instalace čehokoliv):**
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate_labels.ps1
```
Pro vypnutí volitelné stínované vrstvy (čistě plochý tisk):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate_labels.ps1 -Shadow off
```

**Varianta 2 — Python (s volitelnou konverzí do `DeviceCMYK` přes Ghostscript):**
```bash
pip install segno weasyprint
python scripts/generate_labels.py --cmyk-gs
```

---

## 4. Předtisková příprava parciálního laku / reliéfu (Adobe Illustrator / Inkscape)

Pro ofsetové nebo digitální tiskárny vyžadující **jedno sdružené PDF/X-4** s nativní přímou barvou (`Spot_UV` / `Embossing`) a zapnutým přetiskem (*Overprint*):

1. Otevřete `assets/logo_salajka_layers.svg` (nebo vygenerované PDF + separaci ze složky `output/spot/`) v **Adobe Illustratoru** (vrstvy `01_CMYK_Zaklad`, `02_Stinovani_Volitelne`, `03_Spot_UV_Embossing` jsou již odděleny).
2. Spusťte skript **File → Scripts → Other Script... → `scripts/illustrator_prepare_spot.jsx`**.
3. Skript automaticky:
   - vytvoří přímou barvu `Spot_UV` (`C:0 M:100 Y:0 K:0`, `ColorModel.SPOT`),
   - převede text ve vrstvě `Spot_UV` na křivky a nastaví **Overprint Fill**,
   - vyexportuje tiskové **PDF/X-4:2008** s 3 mm spadávkou a ořezovými značkami.
