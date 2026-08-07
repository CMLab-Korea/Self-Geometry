/* Self-Geometry — Interactive Examples tab / grid controller.
 *
 * Layout per (backbone × dataset):
 *   [ Depth  s1 ][ Depth  s2 ][ Depth  s3 ]     ← one card per scene,
 *   [ Point  s1 ][ Point  s2 ][ Point  s3 ]       depth cards carry a frame
 *                                                 carousel (prev/next + dots).
 *
 * Manifest schema (assets/pointmap/manifest.json):
 *   backbones[bb].scenes[ds][i] = {
 *     scene, scene_dirname,
 *     glb:   { baseline: {rgb, error}, ours: {rgb, error} },
 *     depth: { frames: [{idx, baseline:{vis,error}, ours:{vis,error},
 *                        mae_baseline, mae_ours, delta_mae}, ...] },
 *     baseline_fscore, ours_fscore, delta_fscore
 *   }
 */
(() => {
    const MANIFEST_URL = 'assets/pointmap/manifest.json';
    const VIEWER_3D    = 'comparison-viewer.html';
    const VIEWER_2D    = 'comparison-viewer-2d.html';

    const DATASET_DISPLAY = {
        '7scenes':   '7Scenes',
        'hiroom':    'HiRoom',
        'scannetpp': 'ScanNet++',
    };
    const HIDDEN_DATASETS = new Set(['eth3d', '7scenes']);
    const TYPES = ['depth', 'pointmap'];   // grid row order

    let manifest   = null;
    let activeBB   = null;
    let activeDS   = 'scannetpp';  // preferred initial dataset; falls back to
                                   // the backbone's first available if absent
    let activeMode = 'error';      // 'rgb' | 'error'   (predicted map | error map)

    const $ = (sel, root = document) => root.querySelector(sel);

    const sceneLabel = (dataset, scene) => {
        if (dataset === 'hiroom') {
            const parts = scene.split('/');
            if (parts.length === 3) return parts[1];
        }
        return scene;
    };

    // ---------------------------------------------------------------------
    // Source resolution.
    // ---------------------------------------------------------------------
    const currentFrame = (card, s) => {
        if (!s.depth?.frames?.length) return null;
        const idx = parseInt(card.dataset.frameIdx || '0', 10);
        return s.depth.frames[Math.max(0, Math.min(idx, s.depth.frames.length - 1))];
    };

    const resolveSources = (card, s, type) => {
        if (type === 'depth') {
            const f = currentFrame(card, s);
            if (!f) return null;
            const key = activeMode === 'rgb' ? 'vis' : 'error';
            return { viewer: VIEWER_2D, left: f.baseline[key], right: f.ours[key] };
        }
        const g = s.glb;
        if (!g) return null;
        return { viewer: VIEWER_3D, left: g.baseline[activeMode], right: g.ours[activeMode] };
    };

    const viewerSrc = (card, s, type) => {
        const r = resolveSources(card, s, type);
        if (!r) return null;
        const q = new URLSearchParams({
            left: r.left, right: r.right,
            labelLeft: 'Baseline', labelRight: 'Self-Geometry',
        });
        return `${r.viewer}?${q.toString()}`;
    };

    const metricHtml = (card, s, type) => {
        if (type === 'depth') {
            const f = currentFrame(card, s);
            if (!f) return '';
            const rel = f.mae_baseline > 0
                ? ((f.mae_baseline - f.mae_ours) / f.mae_baseline) * 100 : 0;
            const sign = rel >= 0 ? '−' : '+';
            const total = s.depth.frames.length;
            const cur = parseInt(card.dataset.frameIdx || '0', 10) + 1;
            return `<span>MAE: ${f.mae_baseline.toFixed(3)} → ${f.mae_ours.toFixed(3)}` +
                   `<span class="sg-frame-idx">  (frame ${cur} / ${total})</span></span>` +
                   `<span class="sg-delta">${sign}${Math.abs(rel).toFixed(1)}%</span>`;
        }
        const b = s.baseline_fscore, o = s.ours_fscore;
        const rel = b > 0 ? ((o - b) / b) * 100 : 0;
        const sign = rel >= 0 ? '+' : '';
        return `<span>F1-score: ${b.toFixed(2)} → ${o.toFixed(2)}</span>` +
               `<span class="sg-delta">${sign}${rel.toFixed(1)}%</span>`;
    };

    // ---------------------------------------------------------------------
    // Iframe activation + swap.
    // ---------------------------------------------------------------------
    const activateWhenVisible = (iframe, srcResolver) => {
        const doSet = () => {
            const src = srcResolver();
            if (!src || iframe.dataset.currentSrc === src) return;
            iframe.dataset.currentSrc = src;
            iframe.src = src;
        };
        const io = new IntersectionObserver((entries, obs) => {
            for (const e of entries) {
                if (e.isIntersecting) { doSet(); obs.disconnect(); break; }
            }
        }, { rootMargin: '150px 0px' });
        io.observe(iframe);
    };

    const applyIframeSrc = (card, s, type, { force = false } = {}) => {
        const iframe = card.querySelector('iframe');
        if (!iframe) return;
        const src = viewerSrc(card, s, type);
        if (!src) return;
        // Only push a new src to iframes that were already activated (visible).
        // Never-activated iframes keep their IntersectionObserver, which re-reads
        // viewerSrc() on entry and picks up the new state automatically.
        if (iframe.dataset.currentSrc || force) {
            if (iframe.dataset.currentSrc === src) return;
            iframe.dataset.currentSrc = src;
            iframe.src = src;
        }
    };

    const refreshMeta = (card, s, type) => {
        const m = card.querySelector('.sg-metric-row');
        if (m) m.innerHTML = metricHtml(card, s, type);
        const dots = card.querySelectorAll('.sg-dot');
        const idx = parseInt(card.dataset.frameIdx || '0', 10);
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    };

    // ---------------------------------------------------------------------
    // Depth-card carousel.
    // ---------------------------------------------------------------------
    const attachCarousel = (card, s) => {
        const total = s.depth?.frames?.length || 0;
        if (total <= 1) return;

        card.dataset.frameIdx = '0';
        const frame = card.querySelector('.sg-slider-frame');

        const btnPrev = document.createElement('button');
        btnPrev.className = 'sg-nav sg-nav-prev';
        btnPrev.type = 'button';
        btnPrev.setAttribute('aria-label', 'Previous frame');
        btnPrev.innerHTML = '&#10094;';
        const btnNext = document.createElement('button');
        btnNext.className = 'sg-nav sg-nav-next';
        btnNext.type = 'button';
        btnNext.setAttribute('aria-label', 'Next frame');
        btnNext.innerHTML = '&#10095;';

        const dots = document.createElement('div');
        dots.className = 'sg-dots';
        for (let i = 0; i < total; i++) {
            const d = document.createElement('button');
            d.className = 'sg-dot' + (i === 0 ? ' active' : '');
            d.type = 'button';
            d.dataset.i = String(i);
            d.setAttribute('aria-label', `Frame ${i + 1}`);
            d.addEventListener('click', (e) => {
                e.stopPropagation();
                card.dataset.frameIdx = String(i);
                applyIframeSrc(card, s, 'depth');
                refreshMeta(card, s, 'depth');
            });
            dots.appendChild(d);
        }

        const step = (delta) => {
            const cur = parseInt(card.dataset.frameIdx || '0', 10);
            const next = (cur + delta + total) % total;
            card.dataset.frameIdx = String(next);
            applyIframeSrc(card, s, 'depth');
            refreshMeta(card, s, 'depth');
        };
        btnPrev.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
        btnNext.addEventListener('click', (e) => { e.stopPropagation(); step(+1); });

        frame.appendChild(btnPrev);
        frame.appendChild(btnNext);
        frame.appendChild(dots);
    };

    // ---------------------------------------------------------------------
    // Card + grid build.
    // ---------------------------------------------------------------------
    const buildCard = (s, type) => {
        const card = document.createElement('div');
        card.className = 'sg-slider-card sg-card-' + type;
        card.dataset.type = type;
        card.dataset.scene = s.scene;

        const frame = document.createElement('div');
        frame.className = 'sg-slider-frame';

        const placeholder = document.createElement('div');
        placeholder.className = 'sg-loading-placeholder';
        placeholder.textContent = 'Loading viewer…';
        frame.appendChild(placeholder);

        const iframe = document.createElement('iframe');
        iframe.loading = 'lazy';
        iframe.title = `${type}: ${sceneLabel(activeDS, s.scene)}`;
        iframe.addEventListener('load', () => placeholder.remove(), { once: true });
        frame.appendChild(iframe);

        card.appendChild(frame);

        const meta = document.createElement('div');
        meta.className = 'sg-card-meta';
        const label = document.createElement('div');
        label.className = 'sg-scene-label';
        label.textContent = sceneLabel(activeDS, s.scene);
        meta.appendChild(label);
        const metric = document.createElement('div');
        metric.className = 'sg-metric-row';
        metric.innerHTML = metricHtml(card, s, type);
        meta.appendChild(metric);
        card.appendChild(meta);

        if (type === 'depth') attachCarousel(card, s);

        activateWhenVisible(iframe, () => viewerSrc(card, s, type));
        return card;
    };

    const hasDataFor = (s, type) => {
        if (type === 'depth')    return !!(s.depth && s.depth.frames && s.depth.frames.length);
        if (type === 'pointmap') return !!s.glb;
        return false;
    };

    // Cap on scenes to render per (backbone, dataset) combo.
    // Manifest holds the top-3 by absolute Δfscore; we display the top-2 here.
    const MAX_SCENES_PER_COMBO = 2;

    const renderGrid = () => {
        const grid = $('#sgSliderGrid');
        grid.innerHTML = '';
        if (!manifest || !activeBB || !activeDS) return;
        const allScenes = manifest.backbones[activeBB]?.scenes?.[activeDS] || [];
        const scenes = allScenes.slice(0, MAX_SCENES_PER_COMBO);
        if (scenes.length === 0) {
            grid.innerHTML = `<p style="text-align:center;color:#888;grid-column:1/-1;">No scenes for ${activeBB} × ${activeDS}.</p>`;
            return;
        }
        // Depth row: skip scenes without improvement frames entirely.
        // Pointmap row: always the same top-N scenes.
        for (const type of TYPES) {
            for (const s of scenes) {
                if (!hasDataFor(s, type)) continue;
                grid.appendChild(buildCard(s, type));
            }
        }
    };

    // Mode toggle: rebuild srcs of already-activated iframes only.
    const refreshIframes = () => {
        const grid = $('#sgSliderGrid');
        if (!grid) return;
        grid.querySelectorAll('.sg-slider-card').forEach(card => {
            const s = manifest.backbones[activeBB].scenes[activeDS]
                          .find(x => x.scene === card.dataset.scene);
            if (!s) return;
            applyIframeSrc(card, s, card.dataset.type);
            refreshMeta(card, s, card.dataset.type);
        });
    };

    // ---------------------------------------------------------------------
    // Tabs.
    // ---------------------------------------------------------------------
    const renderDatasetTabs = () => {
        const bar = $('#sgDatasetTabs');
        bar.innerHTML = '';
        const bbEntry = manifest.backbones[activeBB];
        if (!bbEntry) return;
        const datasets = manifest.datasets.filter(
            ds => !HIDDEN_DATASETS.has(ds) && (bbEntry.scenes?.[ds] || []).length > 0);
        if (!datasets.includes(activeDS)) activeDS = datasets[0] || null;
        for (const ds of datasets) {
            const b = document.createElement('button');
            b.className = 'sg-tab' + (ds === activeDS ? ' active' : '');
            b.setAttribute('role', 'tab');
            b.dataset.dataset = ds;
            b.textContent = DATASET_DISPLAY[ds] || ds;
            b.addEventListener('click', () => {
                if (activeDS === ds) return;
                activeDS = ds;
                bar.querySelectorAll('.sg-tab').forEach(t => t.classList.toggle('active', t.dataset.dataset === ds));
                renderGrid();
            });
            bar.appendChild(b);
        }
        renderGrid();
    };

    const bindBackboneTabs = () => {
        document.querySelectorAll('.sg-tabs-bb .sg-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const bb = btn.dataset.backbone;
                if (activeBB === bb) return;
                activeBB = bb;
                document.querySelectorAll('.sg-tabs-bb .sg-tab').forEach(t => t.classList.toggle('active', t.dataset.backbone === bb));
                renderDatasetTabs();
            });
        });
    };

    const bindModeTabs = () => {
        document.querySelectorAll('.sg-tabs-mode .sg-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (activeMode === mode) return;
                activeMode = mode;
                document.querySelectorAll('.sg-tabs-mode .sg-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
                refreshIframes();
            });
        });
    };

    const init = async () => {
        try {
            const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
            manifest = await res.json();
        } catch (err) {
            console.error('[Self-Geometry] failed to load manifest:', err);
            const grid = $('#sgSliderGrid');
            if (grid) grid.innerHTML = `<p style="text-align:center;color:#a33;">Failed to load pointmap manifest.</p>`;
            return;
        }
        // Respect whichever backbone button was marked `.active` in the HTML,
        // not just the first one in DOM order.
        activeBB = (document.querySelector('.sg-tabs-bb .sg-tab.active')
                 ?? document.querySelector('.sg-tabs-bb .sg-tab'))?.dataset.backbone;
        bindBackboneTabs();
        bindModeTabs();
        renderDatasetTabs();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
