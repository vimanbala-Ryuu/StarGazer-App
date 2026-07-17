/* =========================================================
   StarGazer — Frontend logic
   Talks to the existing Flask endpoints only:
     POST /analyze   (multipart form field "image")
     GET  /get_logs
   No backend behaviour is assumed beyond what app.py returns.
   ========================================================= */

(function () {
    'use strict';

    /* ---------- State ---------- */
    let selectedFile = null;
    let lastResult = null;
    let historyData = [];
    let sortNewestFirst = true;
    let anomaliesOnly = false;

    /* ---------- Helpers ---------- */
    const $ = (id) => document.getElementById(id);

    function formatBytes(bytes) {
        if (!bytes) return '0 KB';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let val = bytes;
        while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
        return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
    }

    function showToast(message, type) {
        const container = $('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast${type ? ' ' + type : ''}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('leaving');
            setTimeout(() => toast.remove(), 220);
        }, 3200);
    }

    /* ---------- Header: scroll shadow + mobile nav ---------- */
    const header = $('siteHeader');
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 8);
        $('backToTop').hidden = window.scrollY < 500;
    });

    const hamburger = $('hamburgerBtn');
    const mobileNav = $('mobileNav');
    hamburger.addEventListener('click', () => {
        const open = mobileNav.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', String(open));
    });
    mobileNav.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', () => {
            mobileNav.classList.remove('open');
            hamburger.setAttribute('aria-expanded', 'false');
        });
    });

    $('backToTop').addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    $('heroUploadBtn').addEventListener('click', () => scrollToUpload());
    $('headerUploadBtn').addEventListener('click', () => scrollToUpload());
    function scrollToUpload() {
        $('upload').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('fileInput').focus();
    }

    /* ---------- Upload: drag & drop / click / preview ---------- */
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');
    const uploadEmpty = $('uploadEmpty');
    const uploadFilled = $('uploadFilled');
    const scanBtn = $('scanBtn');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    ['dragenter', 'dragover'].forEach((evt) => {
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
    });
    ['dragleave', 'drop'].forEach((evt) => {
        dropZone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
    });
    dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    $('changeImageBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.value = '';
        selectedFile = null;
        uploadFilled.hidden = true;
        uploadEmpty.hidden = false;
        scanBtn.disabled = true;
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Please choose an image file.', 'error');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            showToast('Image is larger than 15MB.', 'error');
            return;
        }
        selectedFile = file;

        const preview = $('preview');
        preview.src = URL.createObjectURL(file);
        $('fileName').textContent = file.name;
        $('fileSize').textContent = formatBytes(file.size);

        // clear any leftover detection overlay from a previous scan
        const overlay = $('previewOverlay');
        overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);

        uploadEmpty.hidden = true;
        uploadFilled.hidden = false;
        scanBtn.disabled = false;
    }

    $('zoomBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        openZoom($('preview').src);
    });
    $('resultZoomBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        openZoom($('resultImage').src);
    });

    /* ---------- Zoom modal ---------- */
    const zoomModal = $('zoomModal');
    function openZoom(src) {
        $('zoomImage').src = src;
        zoomModal.hidden = false;
    }
    function closeZoom() { zoomModal.hidden = true; }
    $('zoomClose').addEventListener('click', closeZoom);
    $('zoomBackdrop').addEventListener('click', closeZoom);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !zoomModal.hidden) closeZoom();
    });

    /* ---------- Loading panel ---------- */
    const loadingSection = $('loadingSection');
    const loadingStepEl = $('loadingStep');
    const loadingFill = $('loadingProgressFill');
    const stepItems = Array.from($('loadingStepsList').children);
    const stepLabels = ['Uploading...', 'Detecting stars...', 'Matching constellation...', 'Retrieving astronomical data...', 'Complete.'];
    let loadingTimer = null;

    function startLoading() {
        loadingSection.hidden = false;
        $('resultsSection').hidden = true;
        $('emptyState').hidden = true;
        loadingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

        let step = 0;
        setStep(0);
        loadingTimer = setInterval(() => {
            if (step < 3) { step++; setStep(step); }
        }, 900);
    }

    function setStep(index) {
        loadingStepEl.textContent = stepLabels[index];
        loadingFill.style.width = `${((index + 1) / stepLabels.length) * 100}%`;
        stepItems.forEach((li, i) => {
            li.classList.toggle('done', i < index);
            li.classList.toggle('active', i === index);
        });
    }

    function finishLoading(success) {
        clearInterval(loadingTimer);
        setStep(4);
        setTimeout(() => {
            loadingSection.hidden = true;
            if (!success) $('emptyState').hidden = false;
        }, 500);
    }

    /* ---------- Scan ---------- */
    scanBtn.addEventListener('click', runScan);

    function runScan() {
        if (!selectedFile) {
            showToast('Choose an image first.', 'error');
            return;
        }
        const formData = new FormData();
        formData.append('image', selectedFile);

        startLoading();
        scanBtn.disabled = true;

        fetch('/analyze', { method: 'POST', body: formData })
            .then((r) => {
                if (!r.ok) throw new Error('Server error');
                return r.json();
            })
            .then((data) => {
                if (data.error) throw new Error(data.error);
                lastResult = data;
                finishLoading(true);
                renderResults(data);
                showToast('Scan complete.', 'success');
                refreshHistory();
            })
            .catch((err) => {
                console.error(err);
                finishLoading(false);
                showToast('Scan failed: signal lost or data corrupted.', 'error');
            })
            .finally(() => { scanBtn.disabled = false; });
    }

    /* ---------- Results rendering ---------- */
    function renderResults(data) {
        const resultsSection = $('resultsSection');
        resultsSection.hidden = false;
        resultsSection.querySelectorAll('.card').forEach((c, i) => {
            c.style.animationDelay = `${i * 60}ms`;
        });

        // Image + overlay
        const img = $('resultImage');
        img.onload = () => {
            if (data.local_stars) drawOverlay($('resultOverlay'), img, data.local_stars);
        };
        img.src = data.image_url;

        // Constellation
        const hasMatch = !!data.constellation_data;
        $('sectorTitle').textContent = hasMatch ? data.constellation_data.name : (data.constellation || 'Unknown');
        $('sectorSub').textContent = hasMatch ? 'Constellation identified' : 'No confident match found';
        const pill = $('detectionStatus');
        pill.textContent = hasMatch ? 'Matched' : 'Unmatched';
        pill.className = 'status-pill ' + (hasMatch ? 'matched' : 'unmatched');

        // Stats
        $('starCountStat').textContent = data.star_count ?? 0;
        $('starIdStat').textContent = (data.identified_stars || []).length;

        // Anomaly
        const banner = $('anomalyBanner');
        if (data.anomaly_text) {
            banner.hidden = false;
            $('anomalyText').textContent = data.anomaly_text;
        } else {
            banner.hidden = true;
        }

        // Wiki info
        const desc = $('sectorDesc');
        const readMore = $('readMoreLink');
        if (hasMatch) {
            desc.textContent = data.constellation_data.summary;
            if (data.constellation_data.url && data.constellation_data.url !== '#') {
                readMore.href = data.constellation_data.url;
                readMore.hidden = false;
            } else {
                readMore.hidden = true;
            }
        } else {
            desc.textContent = 'No matching database entry was found for this field.';
            readMore.hidden = true;
        }

        // Identified stars
        const starListCard = $('starListCard');
        const starList = $('starList');
        starList.innerHTML = '';
        if (data.identified_stars && data.identified_stars.length > 0) {
            starListCard.hidden = false;
            data.identified_stars.forEach((star) => {
                const item = document.createElement('div');
                item.className = 'star-item';
                const summary = (star.summary || '').slice(0, 160);
                item.innerHTML = `<span class="star-name"></span><span class="star-summary"></span>`;
                item.querySelector('.star-name').textContent = star.name;
                item.querySelector('.star-summary').textContent = summary + (star.summary && star.summary.length > 160 ? '…' : '');
                starList.appendChild(item);
            });
        } else {
            starListCard.hidden = true;
        }
    }

    function drawOverlay(canvas, img, stars) {
        // Canvas element fills the same box as the <img>, which uses
        // object-fit: contain — so the rendered image is letterboxed inside
        // that box. Map star coordinates through the *actual* rendered
        // image rect, not the full (padded) box, or boxes land in the
        // empty margins instead of on the stars.
        const boxW = img.clientWidth;
        const boxH = img.clientHeight;
        canvas.width = boxW;
        canvas.height = boxH;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, boxW, boxH);

        if (!img.naturalWidth || !img.naturalHeight) return;

        const imgRatio = img.naturalWidth / img.naturalHeight;
        const boxRatio = boxW / boxH;

        let renderW, renderH, offsetX, offsetY;
        if (imgRatio > boxRatio) {
            // Image is relatively wider than the box: full width, letterboxed top/bottom.
            renderW = boxW;
            renderH = boxW / imgRatio;
            offsetX = 0;
            offsetY = (boxH - renderH) / 2;
        } else {
            // Image is relatively taller than the box: full height, letterboxed left/right.
            renderH = boxH;
            renderW = boxH * imgRatio;
            offsetY = 0;
            offsetX = (boxW - renderW) / 2;
        }

        const scaleX = renderW / img.naturalWidth;
        const scaleY = renderH / img.naturalHeight;

        ctx.strokeStyle = '#4F7CFF';
        ctx.lineWidth = 2;
        stars.forEach((star) => {
            const x = offsetX + star.x * scaleX;
            const y = offsetY + star.y * scaleY;
            ctx.strokeRect(x - 6, y - 6, 12, 12);
        });
    }

    /* ---------- Copy / download result ---------- */
    $('copyResultBtn').addEventListener('click', () => {
        if (!lastResult) { showToast('Run a scan first.', 'error'); return; }
        const name = lastResult.constellation_data ? lastResult.constellation_data.name : lastResult.constellation;
        const summary = lastResult.constellation_data ? lastResult.constellation_data.summary : '';
        const text = `${name}\nStars detected: ${lastResult.star_count}\n\n${summary}`;
        navigator.clipboard.writeText(text)
            .then(() => showToast('Result copied to clipboard.', 'success'))
            .catch(() => showToast('Could not copy result.', 'error'));
    });

    $('downloadResultBtn').addEventListener('click', () => {
        if (!lastResult) { showToast('Run a scan first.', 'error'); return; }
        const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'stargazer-result.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Result downloaded.', 'success');
    });

    /* ---------- History / timeline ---------- */
    function refreshHistory() {
        const timeline = $('timeline');
        timeline.innerHTML = '<p class="timeline-empty" id="timelineEmpty">Loading history…</p>';

        fetch('/get_logs')
            .then((r) => r.json())
            .then((logs) => {
                historyData = Array.isArray(logs) ? logs : [];
                renderTimeline();
            })
            .catch(() => {
                timeline.innerHTML = '<p class="timeline-empty">Could not load history.</p>';
            });
    }

    function renderTimeline() {
        const timeline = $('timeline');
        const query = $('historySearch').value.trim().toLowerCase();

        let rows = historyData.filter((log) => {
            const matchesQuery = !query
                || (log.sector || '').toLowerCase().includes(query)
                || (log.file || '').toLowerCase().includes(query);
            const matchesFilter = !anomaliesOnly || log.anomaly;
            return matchesQuery && matchesFilter;
        });

        rows = rows.slice().sort((a, b) => {
            const cmp = (a.time || '').localeCompare(b.time || '');
            return sortNewestFirst ? -cmp : cmp;
        });

        if (rows.length === 0) {
            timeline.innerHTML = '<p class="timeline-empty">No scans match your search.</p>';
            return;
        }

        timeline.innerHTML = '';
        rows.forEach((log, i) => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
            item.innerHTML = `
                <div class="timeline-thumb"><i class="icon-orbit" aria-hidden="true"></i></div>
                <div class="timeline-body">
                    <div class="timeline-title"></div>
                    <div class="timeline-file"></div>
                </div>
                <div class="timeline-meta">
                    <span class="timeline-date"></span>
                    <span class="timeline-status"></span>
                </div>
            `;
            item.querySelector('.timeline-title').textContent = log.sector || 'Unknown sector';
            item.querySelector('.timeline-file').textContent = log.file || '';
            item.querySelector('.timeline-date').textContent = log.time || '';
            const status = item.querySelector('.timeline-status');
            status.textContent = log.anomaly ? 'Anomaly' : `${log.stars ?? 0} stars`;
            status.classList.toggle('anomaly', !!log.anomaly);
            timeline.appendChild(item);
        });
    }

    $('historySearch').addEventListener('input', renderTimeline);

    $('sortBtn').addEventListener('click', () => {
        sortNewestFirst = !sortNewestFirst;
        $('sortBtn').querySelector('span').textContent = `Sort: ${sortNewestFirst ? 'Newest' : 'Oldest'}`;
        $('sortBtn').setAttribute('aria-pressed', String(!sortNewestFirst));
        renderTimeline();
    });

    $('filterBtn').addEventListener('click', () => {
        anomaliesOnly = !anomaliesOnly;
        $('filterBtn').setAttribute('aria-pressed', String(anomaliesOnly));
        $('filterBtn').classList.toggle('btn-primary', anomaliesOnly);
        $('filterBtn').classList.toggle('btn-secondary', !anomaliesOnly);
        renderTimeline();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (lastResult && lastResult.local_stars && !$('resultsSection').hidden) {
                drawOverlay($('resultOverlay'), $('resultImage'), lastResult.local_stars);
            }
        }, 150);
    });

    /* ---------- Init ---------- */
    refreshHistory();
})();
