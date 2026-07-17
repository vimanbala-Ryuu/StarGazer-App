import cv2
import numpy as np
import requests
import json
import time
import os
import re
import wikipedia
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
# Set ASTRO_API_KEY in a .env file (see .env.example) — never commit real keys.
ASTRO_API_KEY = os.getenv('ASTRO_API_KEY', '')

BASE_URL = "http://nova.astrometry.net/api/"

def resize_for_performance(image_path, max_width=1200):
    try:
        img = cv2.imread(image_path)
        if img is None: return None
            
        height, width = img.shape[:2]
        
        if width > max_width:
            ratio = max_width / width
            new_dim = (max_width, int(height * ratio))
            img = cv2.resize(img, new_dim, interpolation=cv2.INTER_AREA)
        
        cv2.imwrite(image_path, img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return img
    except:
        return None

def detect_stars_local(image_path):
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None: return []

    img = cv2.equalizeHist(img)
    # Smooth sensor/JPEG noise before thresholding so grain isn't mistaken for stars.
    img = cv2.GaussianBlur(img, (3, 3), 0)

    thresh = cv2.adaptiveThreshold(img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY, 11, -5)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detected_objects = []
    for c in contours:
        area = cv2.contourArea(c)
        if not (8 <= area < 600):
            continue

        perimeter = cv2.arcLength(c, True)
        if perimeter == 0:
            continue

        # Stars are round blobs. Filter out streaks, text, and compression
        # artifacts by requiring near-circular shape (1.0 = perfect circle).
        circularity = 4 * np.pi * (area / (perimeter * perimeter))
        if circularity < 0.55:
            continue

        M = cv2.moments(c)
        if M["m00"] != 0:
            cX = int(M["m10"] / M["m00"])
            cY = int(M["m01"] / M["m00"])
            detected_objects.append({'x': cX, 'y': cY, 'size': area})

    # Cap the count so a single very noisy image can't flood the overlay/UI.
    detected_objects.sort(key=lambda s: s['size'], reverse=True)
    return detected_objects[:300]

def solve_field_astrometry(image_path):
    print("\n--- 1. CONTACTING AI CLOUD ---")
    
    if not ASTRO_API_KEY or ASTRO_API_KEY == 'avwxyzuqponmlkji':
        print("CRITICAL ERROR: ASTRO_API_KEY not set. Add it to your .env file.")
        return None

    try:
        # Login
        R = requests.post(BASE_URL + 'login', data={'request-json': json.dumps({"apikey": ASTRO_API_KEY})})
        if R.status_code != 200: return None
        session = R.json().get('session')

        # Upload
        print("Uploading Star Field...")
        with open(image_path, 'rb') as f:
            json_data = {"session": session, "allow_commercial_use": "n", "publicly_visible": "n"}
            resp = requests.post(BASE_URL + 'upload', files={'file': f, 'request-json': (None, json.dumps(json_data))}, timeout=60)
        
        sub_id = resp.json().get('subid')
        if not sub_id: return None
        print(f"Upload Success. Processing ID: {sub_id}")

        # Poll
        for i in range(30): 
            time.sleep(2)
            try:
                job_resp = requests.get(BASE_URL + f'submissions/{sub_id}')
                data = job_resp.json()
                jobs = data.get('jobs', [])
                if jobs and jobs[0]:
                    info = requests.get(BASE_URL + f'jobs/{jobs[0]}/info').json()
                    status = info.get('status')
                    
                    if status == 'success':
                        print("--- 2. PATTERN MATCHED! ---")
                        return info 
                    elif status == 'failure':
                        return None
            except:
                continue
        return None
    except Exception as e:
        print(f"CONNECTION ERROR: {e}")
        return None

def parse_astrometry_tags(tags):
    if not tags: return None, []
    constellation = None
    identified_stars = []
    for tag in tags:
        tag_upper = tag.upper()
        if "CONSTELLATION" in tag_upper:
            # Longest/most specific prefix must be stripped first, otherwise
            # "PART OF THE CONSTELLATION " never matches because the shorter
            # "THE CONSTELLATION " replace already consumed part of it.
            clean = tag_upper.replace("PART OF THE CONSTELLATION ", "").replace("THE CONSTELLATION ", "")
            constellation = clean.split("(")[0].strip().title()
        elif "THE STAR" in tag_upper:
            # Strip the "the star" prefix regardless of its original casing,
            # instead of only matching the literal "The star " string.
            clean = re.sub(r'(?i)^the star\s+', '', tag).split("(")[0].strip()
            if clean:
                identified_stars.append(clean)
    if not constellation and tags:
        constellation = tags[0].split("(")[0]
    return constellation, identified_stars


MIN_WORDS = 700

def get_detailed_wiki(search_term, is_star=False):
    if not search_term:
        return None

    wikipedia.set_lang('en')
    candidates = [
        search_term + (" (star)" if is_star else " (constellation)"),
        search_term,
    ]

    page = None
    for query in candidates:
        try:
            page = wikipedia.page(query, auto_suggest=False)
            break
        except wikipedia.exceptions.DisambiguationError as e:
            # Pick the option that looks most relevant, otherwise the first one.
            options = e.options or []
            pick = next((o for o in options if 'star' in o.lower() or 'constellation' in o.lower()), None)
            pick = pick or (options[0] if options else None)
            if pick:
                try:
                    page = wikipedia.page(pick, auto_suggest=False)
                    break
                except Exception as inner_e:
                    print(f"WIKI DISAMBIGUATION FAILED for '{search_term}': {inner_e}")
                    continue
        except wikipedia.exceptions.PageError:
            continue
        except Exception as e:
            print(f"WIKI ERROR for '{search_term}' ({query}): {e}")
            continue

    if page is None:
        # Last resort: let Wikipedia's own search suggest the closest title.
        try:
            results = wikipedia.search(search_term)
            if results:
                page = wikipedia.page(results[0], auto_suggest=False)
        except Exception as e:
            print(f"WIKI SEARCH FALLBACK FAILED for '{search_term}': {e}")

    if page is None:
        print(f"WIKI: no page found for '{search_term}'")
        return {"name": search_term, "summary": "Detailed records unavailable.", "url": "#"}

    try:
        # Pull enough content to comfortably clear ~700 words; short pages
        # (some minor stars) will simply return everything they have.
        raw_text = page.content[:12000]
        clean_text = raw_text.replace("==", "").replace("\n\n", "\n").strip()

        word_count = len(clean_text.split())
        if word_count < MIN_WORDS:
            print(f"WIKI: '{page.title}' only has {word_count} words available (article is short).")

        final_text = clean_text + "..."
        print(f"Fetched {word_count} words ({len(final_text)} chars) for {search_term}")

        return {
            "name": page.title,
            "summary": final_text,
            "url": page.url
        }
    except Exception as e:
        print(f"WIKI CONTENT ERROR for '{search_term}': {e}")
        return {"name": search_term, "summary": "Detailed records unavailable.", "url": "#"}
