/* Self-Geometry Interactive Examples controller.
 *
 * Manifest schema (assets/pointmap/interactive_manifest.json):
 *   pointmap: [ { backbone, backbone_display, dataset, dataset_display,
 *                 scene, scene_label,
 *                 baseline_fscore, ours_fscore, delta_fscore,
 *                 glb: { baseline:{rgb,error}, ours:{rgb,error} } }, ... ]
 *   depth:    [ { backbone, backbone_display, dataset, dataset_display,
 *                 scene, scene_label, frame_idx, img_name,
 *                 mae_baseline, mae_ours, delta_mae,
 *                 baseline:{vis,error}, ours:{vis,error} }, ... ]
 */
(() => {
    const MANIFEST_URL = 'assets/pointmap/interactive_manifest.json';
    const VIEWER_3D    = 'comparison-viewer.html';
    const VIEWER_2D    = 'comparison-viewer-2d.html';

    let manifest   = null;
    let activeMode = 'error';   // 'rgb' | 'error'

    const $ = (sel, root = document) => root.querySelector(sel);

    // ---------------------------------------------------------------------
    // Source resolution.
    // ---------------------------------------------------------------------
    const pointmapSrc = (entry) => {
        const g = entry.glb;
        if (!g) return null;
        const q = new URLSearchParams({
            left:  g.baseline[activeMode],
            right: g.ours[activeMode],
            labelLeft: 'Baseline', labelRight: 'Self-Geometry',
        });
        return `${VIEWER_3D}?${q.toString()}`;
    };

    const depthSrc = (entry) => {
        const key = activeMode === 'rgb' ? 'vis' : 'error';
        const q = new URLSearchParams({
            left:  entry.baseline[key],
            right: entry.ours[key],
            labelLeft: 'Baseline', labelRight: 'Self-Geometry',
        });
        return `${VIEWER_2D}?${q.toString()}`;
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

    const applyIframeSrc = (card, entry, type) => {
        const iframe = card.querySelector('iframe');
        if (!iframe) return;
        const src = type === 'pointmap' ? pointmapSrc(entry) : depthSrc(entry);
        if (!src) return;
        // Only push a new src to iframes that were already activated (visible).
        // Never-activated iframes keep their IntersectionObserver, which re-reads
        // src on entry and picks up the new state automatically.
        if (!iframe.dataset.currentSrc) return;
        if (iframe.dataset.currentSrc === src) return;
        iframe.dataset.currentSrc = src;
        iframe.src = src;
    };

    // ---------------------------------------------------------------------
    // Card build.
    // ---------------------------------------------------------------------
    const fmt = (n, d = 2) => Number(n).toFixed(d);

    const pointmapMeta = (entry) => {
        const b = entry.baseline_fscore, o = entry.ours_fscore;
        const rel = b > 0 ? ((o - b) / b) * 100 : 0;
        const sign = rel >= 0 ? '+' : '';
        return `<span>F1-score ${fmt(b)} &rarr; ${fmt(o)}</span>` +
               `<span class="sg-delta">${sign}${fmt(rel, 1)}%</span>`;
    };

    const depthMeta = (entry) => {
        const b = entry.mae_baseline, o = entry.mae_ours;
        const rel = b > 0 ? ((b - o) / b) * 100 : 0;
        const sign = rel >= 0 ? '&minus;' : '+';
        return `<span>MAE ${fmt(b, 3)} &rarr; ${fmt(o, 3)}</span>` +
               `<span class="sg-delta">${sign}${fmt(Math.abs(rel), 1)}%</span>`;
    };

    const buildCard = (entry, type) => {
        const card = document.createElement('div');
        card.className = `sg-slider-card sg-card-${type}`;
        card.dataset.type     = type;
        card.dataset.backbone = entry.backbone;

        // Header badge row (backbone name + dataset chip + Δ pill).
        const header = document.createElement('div');
        header.className = 'sg-card-header';
        const bb = document.createElement('span');
        bb.className = 'sg-badge sg-badge-bb';
        bb.innerHTML = entry.backbone_display;
        const ds = document.createElement('span');
        ds.className = 'sg-badge sg-badge-ds';
        ds.textContent = entry.dataset_display;
        const delta = document.createElement('span');
        delta.className = 'sg-badge sg-badge-delta';
        if (type === 'pointmap') {
            const d = (entry.ours_fscore - entry.baseline_fscore) * 100;
            delta.textContent = `+${d.toFixed(1)} F1`;
        } else {
            const d = (entry.mae_baseline - entry.mae_ours);
            delta.textContent = `−${d.toFixed(3)} MAE`;
        }
        header.append(bb, ds, delta);
        card.appendChild(header);

        // Slider frame.
        const frame = document.createElement('div');
        frame.className = 'sg-slider-frame';
        const placeholder = document.createElement('div');
        placeholder.className = 'sg-loading-placeholder';
        placeholder.textContent = 'Loading viewer…';
        frame.appendChild(placeholder);

        const iframe = document.createElement('iframe');
        iframe.loading = 'lazy';
        iframe.title = `${type}: ${entry.backbone_display} · ${entry.scene_label}`;
        iframe.addEventListener('load', () => placeholder.remove(), { once: true });
        frame.appendChild(iframe);
        card.appendChild(frame);

        // Meta row.
        const meta = document.createElement('div');
        meta.className = 'sg-card-meta';
        const label = document.createElement('div');
        label.className = 'sg-scene-label';
        label.textContent = entry.scene_label;
        meta.appendChild(label);
        const metric = document.createElement('div');
        metric.className = 'sg-metric-row';
        metric.innerHTML = type === 'pointmap' ? pointmapMeta(entry) : depthMeta(entry);
        meta.appendChild(metric);
        card.appendChild(meta);

        activateWhenVisible(iframe, () =>
            type === 'pointmap' ? pointmapSrc(entry) : depthSrc(entry));
        return card;
    };

    // ---------------------------------------------------------------------
    // Grid build + mode toggle.
    // ---------------------------------------------------------------------
    const renderRow = (rootId, entries, type) => {
        const root = $(rootId);
        if (!root) return;
        root.innerHTML = '';
        if (!entries || entries.length === 0) {
            root.innerHTML = `<p class="sg-empty">No ${type} entries.</p>`;
            return;
        }
        for (const e of entries) root.appendChild(buildCard(e, type));
    };

    const refreshIframes = () => {
        document.querySelectorAll('.sg-slider-card').forEach(card => {
            const type = card.dataset.type;
            const bb   = card.dataset.backbone;
            const bank = type === 'pointmap' ? manifest.pointmap : manifest.depth;
            const entry = bank.find(e => e.backbone === bb);
            if (entry) applyIframeSrc(card, entry, type);
        });
    };

    const bindModeTabs = () => {
        document.querySelectorAll('.sg-tabs-mode .sg-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (activeMode === mode) return;
                activeMode = mode;
                document.querySelectorAll('.sg-tabs-mode .sg-tab').forEach(t =>
                    t.classList.toggle('active', t.dataset.mode === mode));
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
            const grids = ['#sgPointmapGrid', '#sgDepthGrid'];
            grids.forEach(id => {
                const g = $(id);
                if (g) g.innerHTML = `<p class="sg-empty" style="color:#a33;">Failed to load manifest.</p>`;
            });
            return;
        }
        renderRow('#sgPointmapGrid', manifest.pointmap, 'pointmap');
        renderRow('#sgDepthGrid',    manifest.depth,    'depth');
        bindModeTabs();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
