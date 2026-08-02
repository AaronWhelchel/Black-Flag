/**
 * Black Flag chart — canvas, Web Mercator, pan/zoom, satellite + vector modes.
 * Satellite: Esri World Imagery raster tiles (free with attribution), fetched
 * live by the browser; when offline or blocked, the vector chart (Natural
 * Earth land + hydro pack) renders instead — honestly labeled.
 */
import * as topojson from 'topojson-client';
// @ts-ignore — JSON module bundled by esbuild
import landTopo from 'world-atlas/land-50m.json';
import { RouteWaypoint, haversineNm, initialCourseDeg } from '../packages/core/src/index.js';
import { PIRACY_REGIONS } from '../packages/core/src/risk.js';

const land: any = topojson.feature(landTopo as any, (landTopo as any).objects.land);

export interface Buoy {
  id: string; lat: number; lon: number; obs: string;
  age?: string; stale?: boolean;
}

export interface Obstacle {
  id: string; lat: number; lon: number; label: string; kind: string;
  photo?: string;   // dataURL thumbnail, captain-attached
}

/** Mark symbology — Black Flag's own, not anyone else's. */
export const KIND_STYLE: Record<string, { color: string; glyph: string; hazard: boolean }> = {
  hazard:    { color: '#d9484f', glyph: '!',  hazard: true },
  rock:      { color: '#b3372f', glyph: 'R',  hazard: true },
  shoal:     { color: '#e07b39', glyph: '~',  hazard: true },
  shallow:   { color: '#e07b39', glyph: '~',  hazard: true },
  timber:    { color: '#8a5a2b', glyph: 'T',  hazard: true },
  wreck:     { color: '#7a3b8f', glyph: 'W',  hazard: true },
  bridge:    { color: '#b8860b', glyph: 'H',  hazard: true },
  'no-wake': { color: '#b8860b', glyph: 'N',  hazard: true },
  marina:    { color: '#0b6bcb', glyph: 'M',  hazard: false },
  fuel:      { color: '#0b6bcb', glyph: 'F',  hazard: false },
  ramp:      { color: '#0b6bcb', glyph: '▾',  hazard: false },
  anchorage: { color: '#1e8e4e', glyph: '⚓', hazard: false },
  other:     { color: '#5a6673', glyph: '•',  hazard: true },
};

export type MapMode = 'satellite' | 'chart';
export type ClickMode = 'browse' | 'plot' | 'obstacle';

export interface MapState {
  centerLon: number;
  centerLat: number;
  zoom: number;
  mode: MapMode;
  clickMode: ClickMode;
  waypoints: RouteWaypoint[];
  buoys: Buoy[];
  obstacles: Obstacle[];
  hydro?: { lakes: number[][][]; rivers: number[][][] };
  showBuoys: boolean;
  showPiracy: boolean;
  /** leg indices that pass too close to a hazard — drawn red */
  dangerLegs?: number[];
  onRouteChange?: () => void;
  onObstaclePlace?: (lat: number, lon: number) => void;
  onMarkClick?: (id: string) => void;
}

const TAU = Math.PI * 2;
const TILE = 256;
const clampLat = (l: number) => Math.max(-84, Math.min(84, l));

export class Chart {
  ctx: CanvasRenderingContext2D;
  st: MapState;
  private dragging = false;
  private moved = false;
  private dragWp = -1;          // waypoint being dragged, -1 = none
  private lastX = 0; private lastY = 0;
  private polys: number[][][][] = [];
  private hydroLakes: { ring: number[][]; bb: [number, number, number, number] }[] = [];
  private hydroRivers: { ring: number[][]; bb: [number, number, number, number] }[] = [];
  private tiles = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
  private tileFailures = 0;
  satelliteAvailable = true;   // flips false after repeated failures → honest fallback

  constructor(public canvas: HTMLCanvasElement, st: MapState) {
    this.ctx = canvas.getContext('2d')!;
    this.st = st;
    const geoms = land.features ? land.features.flatMap((f: any) =>
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) :
      land.geometry.type === 'Polygon' ? [land.geometry.coordinates] : land.geometry.coordinates;
    this.polys = geoms;
    if (st.hydro) {
      const bbox = (ring: number[][]) => {
        let a = 180, b = 90, c = -180, d = -90;
        for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
        return [a, b, c, d] as [number, number, number, number];
      };
      this.hydroLakes = st.hydro.lakes.map(p => {
        const ring = (Array.isArray(p[0][0]) ? p[0] : p) as unknown as number[][];
        return { ring, bb: bbox(ring) };
      });
      this.hydroRivers = st.hydro.rivers.map(r => {
        const ring = (Array.isArray((r as any)[0][0]) ? (r as any)[0] : r) as unknown as number[][];
        return { ring, bb: bbox(ring) };
      });
    }
    this.bind();
  }

  private world(): number { return TILE * Math.pow(2, this.st.zoom); }
  project(lon: number, lat: number): [number, number] {
    const w = this.world();
    const x = ((lon + 180) / 360) * w;
    const phi = (clampLat(lat) * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * w;
    const [cx, cy] = this.centerPx();
    return [x - cx + this.canvas.width / 2, y - cy + this.canvas.height / 2];
  }
  private centerPx(): [number, number] {
    const w = this.world();
    const cx = ((this.st.centerLon + 180) / 360) * w;
    const phi = (clampLat(this.st.centerLat) * Math.PI) / 180;
    const cy = ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * w;
    return [cx, cy];
  }
  unproject(px: number, py: number): { lon: number; lat: number } {
    const w = this.world();
    const [cx, cy] = this.centerPx();
    const x = px - this.canvas.width / 2 + cx;
    const y = py - this.canvas.height / 2 + cy;
    const lon = (x / w) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / w;
    return { lon, lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) };
  }

  flyTo(lon: number, lat: number, zoom: number) {
    this.st.centerLon = lon; this.st.centerLat = lat; this.st.zoom = zoom;
    this.render();
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      this.dragging = true; this.moved = false;
      this.lastX = e.offsetX; this.lastY = e.offsetY;
      // Grab a waypoint if the press lands on one (any mode except obstacle placement)
      this.dragWp = -1;
      if (this.st.clickMode !== 'obstacle') {
        for (let i = 0; i < this.st.waypoints.length; i++) {
          const [x, y] = this.project(this.st.waypoints[i].lon, this.st.waypoints[i].lat);
          if (Math.hypot(x - e.offsetX, y - e.offsetY) <= 11) { this.dragWp = i; break; }
        }
      }
      if (this.dragWp >= 0) c.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      if (this.dragWp >= 0 && this.moved) this.st.onRouteChange?.();
      this.dragWp = -1;
      this.dragging = false;
      c.style.cursor = this.st.clickMode === 'browse' ? 'grab' : 'crosshair';
    });
    c.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.offsetX - this.lastX, dy = e.offsetY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      this.lastX = e.offsetX; this.lastY = e.offsetY;
      if (this.dragWp >= 0) {
        const p = this.unproject(e.offsetX, e.offsetY);
        const wp = this.st.waypoints[this.dragWp];
        wp.lat = Math.round(p.lat * 10000) / 10000;
        wp.lon = Math.round(p.lon * 10000) / 10000;
        this.render();
        return;
      }
      const w = this.world();
      this.st.centerLon -= (dx / w) * 360;
      const [, cy] = this.centerPx();
      const n = Math.PI - (2 * Math.PI * (cy - dy)) / w;
      this.st.centerLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      this.render();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.unproject(e.offsetX, e.offsetY);
      this.st.zoom = Math.max(2, Math.min(17, this.st.zoom - Math.sign(e.deltaY) * 0.4));
      const after = this.unproject(e.offsetX, e.offsetY);
      this.st.centerLon += before.lon - after.lon;
      this.st.centerLat += before.lat - after.lat;
      this.render();
    }, { passive: false });
    c.addEventListener('click', (e) => {
      if (this.moved) return;
      // Mark tap first — works in every mode
      for (const o of this.st.obstacles) {
        const [x, y] = this.project(o.lon, o.lat);
        if (Math.hypot(x - e.offsetX, y - e.offsetY) <= 12) { this.st.onMarkClick?.(o.id); return; }
      }
      const p = this.unproject(e.offsetX, e.offsetY);
      if (this.st.clickMode === 'plot') {
        const n = this.st.waypoints.length;
        this.st.waypoints.push({ name: `WP${n + 1}`, lat: Math.round(p.lat * 10000) / 10000, lon: Math.round(p.lon * 10000) / 10000 });
        this.st.onRouteChange?.();
        this.render();
      } else if (this.st.clickMode === 'obstacle') {
        this.st.onObstaclePlace?.(Math.round(p.lat * 10000) / 10000, Math.round(p.lon * 10000) / 10000);
      }
    });
  }

  // ---- satellite tiles ----

  private tileUrl(z: number, x: number, y: number): string {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }

  private drawTiles(): boolean {
    const { canvas, ctx, st } = this;
    const z = Math.min(17, Math.max(2, Math.round(st.zoom)));
    const scale = Math.pow(2, st.zoom - z);
    const n = Math.pow(2, z);
    const [cx, cy] = this.centerPx();
    const originX = cx - canvas.width / 2, originY = cy - canvas.height / 2;
    const size = TILE * scale;
    const x0 = Math.floor(originX / size), y0 = Math.floor(originY / size);
    const x1 = Math.floor((originX + canvas.width) / size), y1 = Math.floor((originY + canvas.height) / size);
    let drewAny = false;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
        const wx = ((tx % n) + n) % n;
        const key = `${z}/${wx}/${ty}`;
        let t = this.tiles.get(key);
        if (t === undefined) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          this.tiles.set(key, 'loading');
          img.onload = () => { this.tiles.set(key, img); this.tileFailures = 0; this.satelliteAvailable = true; this.render(); };
          img.onerror = () => {
            this.tiles.set(key, 'failed');
            this.tileFailures += 1;
            if (this.tileFailures > 6) { this.satelliteAvailable = false; this.render(); }
          };
          img.src = this.tileUrl(z, wx, ty);
          t = 'loading';
        }
        if (t instanceof HTMLImageElement) {
          ctx.drawImage(t, tx * size - originX, ty * size - originY, size + 0.5, size + 0.5);
          drewAny = true;
        }
      }
    }
    return drewAny;
  }

  // ---- render ----

  render() {
    const { ctx, canvas, st } = this;
    const W = canvas.width, H = canvas.height;
    const light = st.mode === 'chart';
    ctx.fillStyle = light ? '#cfe3f2' : '#0b1420';
    ctx.fillRect(0, 0, W, H);

    let satDrawn = false;
    if (st.mode === 'satellite' && this.satelliteAvailable) satDrawn = this.drawTiles();

    const tl = this.unproject(0, 0), br = this.unproject(W, H);

    if (!satDrawn) {
      // vector chart (also the offline fallback under satellite mode)
      ctx.strokeStyle = light ? 'rgba(90,130,160,0.25)' : 'rgba(80,110,140,0.18)';
      ctx.lineWidth = 1;
      const step = st.zoom >= 8 ? 0.5 : st.zoom >= 6 ? 1 : st.zoom >= 4 ? 5 : 15;
      for (let lon = Math.floor(tl.lon / step) * step; lon <= br.lon + step; lon += step) {
        const [x] = this.project(lon, st.centerLat);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let lat = Math.floor(br.lat / step) * step; lat <= tl.lat + step; lat += step) {
        const [, y] = this.project(st.centerLon, lat);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.fillStyle = light ? '#e9e4d5' : '#232a25';
      ctx.strokeStyle = light ? '#c9c2ac' : '#39423a';
      ctx.beginPath();
      for (const poly of this.polys) {
        for (const ring of poly) {
          let first = true;
          for (const [lon, lat] of ring) {
            const [x, y] = this.project(lon as number, lat as number);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      }
      ctx.fill(); ctx.stroke();

      if (this.hydroLakes.length && st.zoom >= 4.2) {
        const vis = (bb: [number, number, number, number]) =>
          !(bb[2] < tl.lon || bb[0] > br.lon || bb[3] < br.lat || bb[1] > tl.lat);
        ctx.fillStyle = light ? '#cfe3f2' : '#0d2033';
        ctx.beginPath();
        for (const { ring, bb } of this.hydroLakes) {
          if (!vis(bb)) continue;
          let first = true;
          for (const [lon, lat] of ring) {
            const [x, y] = this.project(lon, lat);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        ctx.fill();
        ctx.beginPath();
        for (const { ring, bb } of this.hydroRivers) {
          if (!vis(bb)) continue;
          let first = true;
          for (const [lon, lat] of ring) {
            const [x, y] = this.project(lon, lat);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    const ink = satDrawn ? '#ffffff' : (light ? '#1a2733' : '#e8ecf1');
    const halo = satDrawn ? 'rgba(0,0,0,0.75)' : (light ? 'rgba(255,255,255,0.85)' : 'rgba(10,16,24,0.8)');
    const label = (text: string, x: number, y: number, color = ink, font = '11px -apple-system, sans-serif') => {
      ctx.font = font;
      ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    };

    // piracy overlay
    if (st.showPiracy) {
      for (const r of PIRACY_REGIONS) {
        const [x1, y1] = this.project(r.bbox[0], r.bbox[3]);
        const [x2, y2] = this.project(r.bbox[2], r.bbox[1]);
        if (x2 < 0 || x1 > W || y2 < 0 || y1 > H) continue;
        ctx.fillStyle = 'rgba(217,72,72,0.14)';
        ctx.strokeStyle = 'rgba(217,72,72,0.55)';
        ctx.setLineDash([6, 4]);
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
        label(`⚠ ${r.name} · IMB level ${r.level}`, x1 + 6, y1 + 14, '#e05555');
      }
    }

    // buoys
    if (st.showBuoys) {
      for (const b of st.buoys) {
        const [x, y] = this.project(b.lon, b.lat);
        if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
        ctx.fillStyle = '#0b6bcb';
        ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(11,107,203,.45)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke();
        label(`${b.id} · ${b.obs}`, x + 10, y - 2);
        if (b.age) label(b.age, x + 10, y + 11, b.stale ? '#b8860b' : (satDrawn ? '#d8dee6' : '#7a8694'), '10px -apple-system, sans-serif');
      }
    }

    // captain's marks — Black Flag pin symbology
    for (const o of st.obstacles) {
      const [x, y] = this.project(o.lon, o.lat);
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      const style = KIND_STYLE[o.kind] ?? KIND_STYLE.other;
      // stem
      ctx.fillStyle = style.color;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y - 8); ctx.lineTo(x + 4, y - 8); ctx.closePath(); ctx.fill();
      // head
      ctx.beginPath(); ctx.arc(x, y - 15, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px -apple-system, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(style.glyph, x, y - 11.5);
      ctx.textAlign = 'start';
      // photo badge
      if (o.photo) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x + 7, y - 21, 3.4, 0, TAU); ctx.fill();
        ctx.fillStyle = style.color;
        ctx.beginPath(); ctx.arc(x + 7, y - 21, 2, 0, TAU); ctx.fill();
      }
      if (st.zoom >= 9.5) label(o.label, x + 12, y - 12, style.color);
    }

    // route
    const wps = st.waypoints;
    if (wps.length > 0) {
      const danger = new Set(st.dangerLegs ?? []);
      ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
      for (let i = 0; i < wps.length - 1; i++) {
        ctx.strokeStyle = danger.has(i) ? '#e02d2d' : (satDrawn ? '#ffd76a' : '#c9922e');
        ctx.beginPath();
        const [x1, y1] = this.project(wps[i].lon, wps[i].lat);
        const [x2, y2] = this.project(wps[i + 1].lon, wps[i + 1].lat);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (let i = 0; i < wps.length; i++) {
        const [x, y] = this.project(wps[i].lon, wps[i].lat);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        label(wps[i].name, x + 8, y - 6);
        if (i > 0) {
          const d = haversineNm(wps[i - 1], wps[i]);
          const crs = Math.round(initialCourseDeg(wps[i - 1], wps[i]));
          const [mx, my] = this.project((wps[i - 1].lon + wps[i].lon) / 2, (wps[i - 1].lat + wps[i].lat) / 2);
          label(`${Math.round(d * 10) / 10} nm · ${String(crs).padStart(3, '0')}°`, mx + 8, my - 10, satDrawn ? '#ffd76a' : '#c9922e', 'bold 11px -apple-system, sans-serif');
        }
      }
    }

    // scale bar + attribution
    const nmPerPx = haversineNm(this.unproject(10, H - 20), this.unproject(110, H - 20)) / 100;
    const targetNm = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5].find(nn => nn / nmPerPx <= 160) ?? 0.5;
    const barPx = targetNm / nmPerPx;
    ctx.strokeStyle = ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, H - 18); ctx.lineTo(14 + barPx, H - 18); ctx.stroke();
    label(`${targetNm} nm`, 14, H - 24);
    label(
      satDrawn
        ? 'Imagery © Esri, Maxar, Earthstar Geographics · Not for navigation'
        : `${st.mode === 'satellite' ? 'Satellite unavailable offline — vector chart shown · ' : ''}Coastline: Natural Earth · Not for navigation`,
      14, H - 7, satDrawn ? '#d8dee6' : (light ? '#5a6b7a' : '#7a8694'), '9px -apple-system, sans-serif',
    );
  }
}
