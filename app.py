from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
import os
import json
import datetime
import time
from dotenv import load_dotenv
# Import logic from your scanner.py file
from scanner import detect_stars_local, resize_for_performance, solve_field_astrometry, parse_astrometry_tags, get_detailed_wiki

load_dotenv()
app = Flask(__name__)

# --- CONFIGURATION ---
UPLOAD_FOLDER = 'static/uploads'
LOG_FILE = 'logs.json'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Auto-create logs file if it doesn't exist
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w') as f: json.dump([], f)

def save_to_log(filename, constellation, star_count, anomaly):
    """Saves the scan result to the local mission log."""
    entry = {
        "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "file": filename,
        "sector": constellation,
        "stars": star_count,
        "anomaly": anomaly
    }
    try:
        with open(LOG_FILE, 'r+') as f:
            data = json.load(f)
            data.insert(0, entry) # Add to top of list
            f.seek(0)
            json.dump(data[:50], f) # Keep only last 50 entries
    except: pass

@app.route('/')
def home():
    """Renders the main dashboard."""
    return render_template('index.html')

@app.route('/get_logs')
def get_logs():
    """API to fetch the Mission Logs for the menu."""
    try:
        with open(LOG_FILE, 'r') as f: return jsonify(json.load(f))
    except: return jsonify([])

@app.route('/analyze', methods=['POST'])
def analyze():
    """The Main Brain: Handles Image Upload -> Processing -> AI Analysis"""
    try:
        if 'image' not in request.files: return jsonify({"error": "No file uploaded"}), 400
        file = request.files['image']
        if file.filename == '': return jsonify({"error": "No file selected"}), 400

        safe_name = secure_filename(file.filename)
        ext = safe_name.rsplit('.', 1)[-1].lower() if '.' in safe_name else ''
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({"error": "Unsupported file type. Please upload a PNG, JPG, GIF, BMP, or WEBP image."}), 400

        # 1. UNIQUE FILENAME (Fixes caching issues)
        timestamp = int(time.time())
        filename = f"scan_{timestamp}_{safe_name}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        # 2. OPTIMIZE IMAGE (Prevents crashes on large photos)
        # We use 1000px width to balance speed vs accuracy
        if resize_for_performance(filepath, max_width=1000) is None:
             return jsonify({"error": "Image file is corrupt or unreadable."}), 400
        
        # 3. LOCAL SCAN (Green Boxes)
        local_stars = detect_stars_local(filepath)

        # 4. CLOUD SCAN (Astrometry.net API)
        solved_data = solve_field_astrometry(filepath)
        
        main_constellation = "Unknown Sector"
        constellation_info = None
        star_profiles = []
        anomaly_text = ""
        
        if solved_data:
            # Parse the messy tags into clean names
            raw_tags = solved_data.get('machine_tags', []) + solved_data.get('objects_in_field', [])
            constellation_name, star_names = parse_astrometry_tags(raw_tags)
            
            # Fetch Detailed Wiki Data for Sector
            if constellation_name:
                main_constellation = constellation_name
                constellation_info = get_detailed_wiki(constellation_name, is_star=False)
                
            # Fetch Detailed Wiki Data for each Star
            for star in star_names:
                profile = get_detailed_wiki(star, is_star=True)
                if profile: star_profiles.append(profile)
        
        # 5. SMART ANOMALY LOGIC
        # If we found stars locally (green boxes) but the Cloud AI returned nothing, flag it.
        if len(local_stars) > 10 and not solved_data:
            anomaly_text = "CRITICAL: UNMAPPED SECTOR. High stellar density detected locally, but Global Database match failed."
        elif not local_stars:
            anomaly_text = "VISUAL ERROR: Sensor failed to resolve distinct stellar objects."

        # 6. SAVE LOGS
        save_to_log(filename, main_constellation, len(local_stars), bool(anomaly_text))

        # 7. RETURN DATA TO FRONTEND
        return jsonify({
            "status": "success",
            "image_url": f"/static/uploads/{filename}", # Send new URL
            "star_count": len(local_stars),
            "constellation": main_constellation,
            "constellation_data": constellation_info,
            "identified_stars": star_profiles,
            "local_stars": local_stars,
            "anomaly_text": anomaly_text
        })

    except Exception as e:
        print(f"SERVER ERROR: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Threaded mode allows multiple requests (prevents freezing)
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    port = int(os.getenv('PORT', 5000))
    app.run(debug=debug_mode, threaded=True, host='0.0.0.0', port=port)