# 🌌 StarGazer

StarGazer is a Flask web app that identifies constellations from uploaded night sky images. It combines local star detection with OpenCV, plate solving via the Astrometry.net API, and reference info from Wikipedia — presented in a modern, responsive UI.

---

## ✨ Features

- 📸 Drag-and-drop or click-to-upload night sky images
- ⭐ Local star detection with OpenCV, drawn as an overlay on the image
- 🌌 Constellation matching via Astrometry.net plate solving
- 📖 Constellation and star details pulled from Wikipedia
- 📊 Result cards: image preview, constellation, statistics, info, identified stars
- 📜 Scan history with search, sort, and anomaly filter
- 🔍 Image zoom modal, copy/download result, toast notifications
- 🎨 Clean, responsive UI (desktop, tablet, mobile) with accessible keyboard navigation

---

## 📁 Project Structure

```
StarGazer/
│
├── app.py                  # Flask app + routes
├── scanner.py               # Star detection, plate solving, Wikipedia lookups
├── requirements.txt
├── .env.example             # Copy to .env and fill in your values
├── .gitignore
├── logs.json                # Scan history (auto-generated, gitignored)
│
├── static/
│   ├── css/style.css
│   ├── js/script.js
│   └── uploads/              # Uploaded/processed images (gitignored)
│
└── templates/
    └── index.html
```

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/StarGazer.git
cd StarGazer
```

### 2. Create a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set your own Astrometry.net API key (get one free at https://nova.astrometry.net/):

```
ASTRO_API_KEY=your_astrometry_net_api_key
FLASK_DEBUG=False
PORT=5000
```

`.env` is gitignored — never commit real keys.

---

## ▶ Running locally

```bash
python app.py
```

Visit `http://127.0.0.1:5000`.

To run on a different port: `PORT=5001 python app.py`, or `flask run --port 5001`.

---

## 🛠 How it works

1. Upload a night sky image (saved to `static/uploads/`).
2. OpenCV detects stars locally and returns their coordinates.
3. The image is sent to Astrometry.net for plate solving.
4. The matched constellation and star names are parsed from the result.
5. Wikipedia supplies summary text for the constellation and each identified star.
6. The scan (time, file, sector, star count, anomaly flag) is appended to `logs.json`.
7. The frontend renders the image with a detection overlay, result cards, and adds the scan to the history timeline.

---

## 📦 Dependencies

- Flask, gunicorn
- opencv-python-headless, numpy, Pillow
- requests, astroquery, astropy
- wikipedia
- python-dotenv

All pinned versions are in `requirements.txt`.

---

## 🌐 External services

- **Astrometry.net API** — plate solving / constellation matching
- **Wikipedia API** — reference summaries

An internet connection is required for both. If `ASTRO_API_KEY` is unset, plate solving is skipped and the scan falls back to local star detection only.

---

## ⚠ Troubleshooting

**ModuleNotFoundError** — re-run `pip install -r requirements.txt` inside your active virtual environment.

**No constellation detected / "ASTRO_API_KEY not set"** — check `.env` has a valid key and was loaded (restart the server after editing `.env`).

**Port already in use** — `PORT=5001 python app.py`.

**Blank or unstyled page** — confirm `static/css/style.css` and `static/js/script.js` return 200 in your browser's network tab; hard-refresh to bypass cache.

---

## 🚀 Deployment (Render)

**Build command:**
```bash
pip install -r requirements.txt
```

**Start command:**
```bash
gunicorn app:app
```

**Environment variables** (set in the Render dashboard, not in code):
- `ASTRO_API_KEY`
- `FLASK_DEBUG=False`

Render sets `PORT` automatically; `app.py` reads it via `os.getenv('PORT', 5000)`.

---

## 🔮 Future improvements

- Offline constellation recognition / local star catalog
- Interactive sky map
- PWA support
- User accounts and per-user history

---

## 📄 License

MIT License.
