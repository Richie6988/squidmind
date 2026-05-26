/**
 * PixelIcons - Colorful hand-crafted 16x16 pixel art icons
 * 
 * Each icon has a palette and pixels reference palette indices.
 * Format: "P x y w h"  where P is palette index, then x,y,w,h coords
 * 
 * Usage:
 *   PixelIcons.render('squid')        → SVG element
 *   PixelIcons.inline('squid', 16)    → SVG string
 *   PixelIcons.replaceTags(el)        → swap [TAG] text with icons
 */

const PixelIcons = {
  ICONS: {
    // Squid: pink body, dark outline, white eyes, black pupils
    squid: {
      palette: ["#FF6B9D", "#C44569", "#FFFFFF", "#1A1A1A", "#FFB6C1"],
      pixels: [
        // outline (dark)
        "1 5 0 6 1", "1 4 1 1 1", "1 11 1 1 1", "1 3 2 1 4", "1 12 2 1 4",
        // body main (pink)
        "0 5 1 6 6", "0 4 2 8 4", "0 3 6 10 2",
        // belly (lighter pink)
        "4 5 3 6 3",
        // eyes (white)
        "2 6 3 1 1", "2 9 3 1 1",
        // pupils (black)
        "3 6 4 1 1", "3 9 4 1 1",
        // tentacles (pink)
        "0 3 8 2 5", "0 6 8 2 5", "0 9 8 2 5", "0 12 8 2 5",
        // tentacle tips (darker)
        "1 2 12 2 2", "1 5 13 2 1", "1 8 13 2 1", "1 11 13 2 1", "1 13 12 1 1"
      ]
    },
    
    // Temple: stone grey columns, gold pediment trim
    temple: {
      palette: ["#A8A8A8", "#7A7A7A", "#FFD700", "#5A5A5A"],
      pixels: [
        // pediment (gold edge)
        "2 7 1 2 1", "2 6 2 4 1", "2 5 3 6 1", "2 4 4 8 1",
        // architrave (mid grey)
        "1 3 5 10 1", "1 2 6 12 1",
        // columns (light grey)
        "0 3 7 2 7", "0 7 7 2 7", "0 11 7 2 7",
        // column shading (dark)
        "3 4 7 1 7", "3 8 7 1 7", "3 12 7 1 7",
        // base
        "1 2 14 12 1", "3 1 15 14 1"
      ]
    },
    
    // Poseidon trident: gold
    poseidon: {
      palette: ["#FFD700", "#B8860B", "#FFA500"],
      pixels: [
        "0 3 1 2 5", "0 7 1 2 5", "0 11 1 2 5",
        "1 4 1 1 5", "1 8 1 1 5", "1 12 1 1 5",
        "0 2 6 12 2",
        "1 2 7 12 1",
        "0 7 8 2 7",
        "1 7 14 2 1"
      ]
    },
    
    // System / Gear: green & dark
    system: {
      palette: ["#06FFA5", "#1A4D3E", "#000000"],
      pixels: [
        "0 7 1 2 2", "0 7 13 2 2", "0 1 7 2 2", "0 13 7 2 2",
        "0 2 2 2 2", "0 12 2 2 2", "0 2 12 2 2", "0 12 12 2 2",
        "0 4 4 8 8",
        "1 5 5 6 6",
        "2 6 6 4 4"
      ]
    },
    
    // CPU chip: blue body, gold pins
    cpu: {
      palette: ["#FFD700", "#1E3A8A", "#06FFA5", "#000000"],
      pixels: [
        // pins (gold)
        "0 3 0 2 2", "0 7 0 2 2", "0 11 0 2 2",
        "0 3 14 2 2", "0 7 14 2 2", "0 11 14 2 2",
        "0 0 3 2 2", "0 0 7 2 2", "0 0 11 2 2",
        "0 14 3 2 2", "0 14 7 2 2", "0 14 11 2 2",
        // body (dark blue)
        "1 2 2 12 12",
        // chip inner (green)
        "2 5 5 6 6",
        // dot
        "3 7 7 2 2"
      ]
    },
    
    // Chart bars: rainbow ascending
    stats: {
      palette: ["#FF4444", "#FF9944", "#FFDD44", "#44DD44", "#4499FF"],
      pixels: [
        // axes
        "0 1 14 1 1", "0 1 2 1 12",
        // bars ascending
        "0 3 11 2 3",
        "1 6 8 2 6",
        "2 9 6 2 8",
        "3 12 4 2 10",
        "4 13 4 1 10"
      ]
    },
    
    // Tasks: green checks
    tasks: {
      palette: ["#06FFA5", "#1A4D3E", "#FFFFFF", "#888888"],
      pixels: [
        // Box 1 outline
        "1 1 1 4 4",
        // check 1 (green)
        "0 4 2 1 1", "0 3 3 1 1", "0 2 3 1 1", "0 1 3 1 1",
        // line 1 (white)
        "2 7 2 8 1", "2 7 3 6 1",
        // Box 2
        "1 1 6 4 4",
        "0 4 7 1 1", "0 3 8 1 1", "0 2 8 1 1", "0 1 8 1 1",
        "2 7 7 8 1", "2 7 8 6 1",
        // Box 3 (empty)
        "1 1 11 4 1", "1 1 12 1 3", "1 4 12 1 3", "1 1 14 4 1",
        // dim line 3
        "3 7 12 8 1", "3 7 13 6 1"
      ]
    },
    
    // Target: red bullseye
    target: {
      palette: ["#DC2626", "#FFFFFF", "#FBBF24"],
      pixels: [
        // outer ring (red)
        "0 5 1 6 1", "0 3 2 2 1", "0 11 2 2 1",
        "0 2 3 1 1", "0 13 3 1 1",
        "0 1 4 1 2", "0 14 4 1 2",
        "0 1 6 1 4", "0 14 6 1 4",
        "0 1 10 1 2", "0 14 10 1 2",
        "0 2 12 1 1", "0 13 12 1 1",
        "0 3 13 2 1", "0 11 13 2 1",
        "0 5 14 6 1",
        // mid ring (white)
        "1 5 4 6 1", "1 4 5 1 6", "1 5 11 6 1", "1 11 5 1 6",
        // center (yellow)
        "2 7 7 2 2"
      ]
    },
    
    // Wrench config: silver/grey
    config: {
      palette: ["#C0C0C0", "#606060", "#FFD700"],
      pixels: [
        "0 10 1 3 3", "1 9 2 1 2",
        "0 9 4 3 1", "0 8 5 3 1",
        "0 7 6 3 1", "0 6 7 3 1",
        "0 5 8 3 1", "0 4 9 3 1",
        "0 3 10 3 1", "0 2 11 3 1",
        "2 1 12 3 3", "1 3 13 1 1"
      ]
    },
    
    // Plus: green + button
    plus: {
      palette: ["#06FFA5", "#1A4D3E"],
      pixels: [
        "1 6 1 4 14", "1 1 6 14 4",
        "0 7 2 2 12", "0 2 7 12 2"
      ]
    },
    
    // Brain: pink/purple
    brain: {
      palette: ["#EC4899", "#9D174D", "#FFFFFF"],
      pixels: [
        "1 5 2 6 1",
        "1 3 3 4 1", "1 9 3 4 1",
        "1 2 4 4 1", "1 10 4 4 1",
        "0 2 5 5 1", "0 9 5 5 1",
        "0 1 6 6 4", "0 9 6 6 4",
        "2 4 7 2 1", "2 10 7 2 1",
        "0 2 10 5 1", "0 9 10 5 1",
        "0 3 11 4 1", "0 9 11 4 1",
        "0 4 12 3 1", "0 9 12 3 1",
        "1 5 13 6 1"
      ]
    },
    
    // Logs / Document: white paper, blue lines
    logs: {
      palette: ["#FFFFFF", "#2563EB", "#999999"],
      pixels: [
        // page
        "0 3 1 9 14",
        // edge shadow
        "2 3 1 9 1", "2 3 14 9 1", "2 3 1 1 14", "2 11 1 1 14",
        // text lines
        "1 5 4 5 1",
        "1 5 6 5 1",
        "1 5 8 5 1",
        "1 5 10 5 1",
        "1 5 12 3 1"
      ]
    },
    
    // Team: 3 colored people
    team: {
      palette: ["#F87171", "#60A5FA", "#34D399", "#444444"],
      pixels: [
        // person 1 (red) head + body
        "0 3 3 2 2", "0 2 5 4 3",
        // person 2 (blue) - taller, center
        "1 7 1 2 2", "1 6 3 4 5",
        // person 3 (green)
        "2 11 3 2 2", "2 10 5 4 3",
        // base shadow
        "3 1 9 14 1"
      ]
    },
    
    // Models: stacked colored boxes
    models: {
      palette: ["#F59E0B", "#10B981", "#6366F1", "#FBBF24"],
      pixels: [
        "0 2 2 12 3",
        "1 2 6 12 3",
        "2 2 10 12 3",
        // labels (yellow)
        "3 4 3 1 1", "3 4 7 1 1", "3 4 11 1 1"
      ]
    },
    
    // Data / Database: blue cylinders
    data: {
      palette: ["#3B82F6", "#1E40AF", "#06B6D4"],
      pixels: [
        // top
        "2 3 1 10 1", "0 3 1 10 2", "1 3 2 10 1",
        // body 1
        "0 2 4 12 2", "1 2 5 12 1",
        // body 2
        "0 3 7 10 2", "1 3 8 10 1",
        // body 3
        "0 2 10 12 2", "1 2 11 12 1",
        // bottom
        "0 3 13 10 2", "1 3 14 10 1"
      ]
    },
    
    // Wave / Ocean: blue waves
    ocean: {
      palette: ["#3B82F6", "#06B6D4", "#0EA5E9"],
      pixels: [
        "0 1 5 2 1", "1 3 4 2 1", "0 5 5 2 1", "1 7 4 2 1", "0 9 5 2 1", "1 11 4 2 1", "0 13 5 2 1",
        "0 1 9 2 1", "1 3 8 2 1", "0 5 9 2 1", "1 7 8 2 1", "0 9 9 2 1", "1 11 8 2 1", "0 13 9 2 1",
        "2 1 13 2 1", "0 3 12 2 1", "2 5 13 2 1", "0 7 12 2 1", "2 9 13 2 1", "0 11 12 2 1", "2 13 13 2 1"
      ]
    },
    
    // Rocket: red body, blue flame
    launch: {
      palette: ["#DC2626", "#FBBF24", "#06B6D4", "#FFFFFF"],
      pixels: [
        // tip
        "0 7 1 2 2",
        // body
        "0 6 3 4 2",
        "3 5 5 6 4",
        // window
        "2 7 6 2 2",
        // fins
        "0 4 9 2 4", "0 10 9 2 4",
        // engine
        "0 6 9 1 3", "0 9 9 1 3",
        // flame
        "1 7 12 2 2"
      ]
    },
    
    // OK Check: green
    ok: {
      palette: ["#10B981", "#065F46"],
      pixels: [
        "1 12 4 2 2",
        "0 12 3 2 2",
        "1 10 6 2 2",
        "0 10 5 2 2",
        "1 8 8 2 2",
        "0 8 7 2 2",
        "1 6 10 2 2",
        "0 6 9 2 2",
        "1 2 8 2 2",
        "0 2 7 2 2",
        "1 4 10 2 2",
        "0 4 9 2 2"
      ]
    },
    
    // Error X: red
    error: {
      palette: ["#EF4444", "#991B1B"],
      pixels: [
        "0 2 2 2 2", "0 4 4 2 2", "0 6 6 2 2", "0 8 8 2 2", "0 10 10 2 2", "0 12 12 2 2",
        "0 12 2 2 2", "0 10 4 2 2", "0 8 6 2 2", "0 6 8 2 2", "0 4 10 2 2", "0 2 12 2 2"
      ]
    },
    
    // Info: blue i
    info: {
      palette: ["#3B82F6", "#FFFFFF", "#1E40AF"],
      pixels: [
        // circle outline
        "0 5 1 6 1", "0 3 2 2 1", "0 11 2 2 1",
        "0 2 3 1 2", "0 13 3 1 2",
        "0 1 5 1 6", "0 14 5 1 6",
        "0 2 11 1 2", "0 13 11 1 2",
        "0 3 13 2 1", "0 11 13 2 1",
        "0 5 14 6 1",
        // inside (white)
        "1 5 5 6 8", "1 3 6 1 8", "1 12 6 1 8",
        // i (dark blue)
        "2 7 4 2 2",
        "2 7 7 2 6"
      ]
    },
    
    // Egg / Create: pink with sparkle
    create: {
      palette: ["#FBCFE8", "#F472B6", "#FFFFFF"],
      pixels: [
        "1 6 1 4 1",
        "0 5 2 6 1",
        "1 4 3 8 1",
        "0 4 4 8 1",
        "0 3 5 10 1",
        "0 3 6 10 7",
        "2 5 8 1 1", "2 6 9 1 1",
        "0 4 13 8 1",
        "1 5 14 6 1"
      ]
    },
    
    // Mouse pointer: white with black outline
    mouse: {
      palette: ["#FFFFFF", "#000000", "#3B82F6"],
      pixels: [
        // outline
        "1 3 2 1 11",
        "1 4 13 1 1",
        // arrow body
        "0 4 3 1 1", "0 4 4 1 1", "0 4 5 1 1", "0 4 6 1 1", "0 4 7 1 1", "0 4 8 1 1", "0 4 9 1 1", "0 4 10 1 1", "0 4 11 1 1", "0 4 12 1 1",
        "0 5 4 1 1", "0 5 5 1 1", "0 5 6 1 1", "0 5 7 1 1", "0 5 8 1 1", "0 5 9 1 1", "0 5 10 1 1", "0 5 11 1 1",
        "0 6 5 1 1", "0 6 6 1 1", "0 6 7 1 1", "0 6 8 1 1", "0 6 9 1 1", "0 6 10 1 1",
        "0 7 6 1 1", "0 7 7 1 1", "0 7 8 1 1", "0 7 9 1 1",
        "0 8 7 1 1", "0 8 8 1 1",
        // tail
        "2 9 10 2 4", "0 11 9 1 1"
      ]
    },
    
    // Cursor interact: blue cursor
    interact: {
      palette: ["#3B82F6", "#1E40AF"],
      pixels: [
        "1 3 2 1 11",
        "0 4 3 1 1", "0 4 5 1 1", "0 4 7 1 1", "0 4 9 1 1", "0 4 11 1 1",
        "0 5 4 1 1", "0 5 6 1 1", "0 5 8 1 1", "0 5 10 1 1",
        "0 6 5 1 1", "0 6 7 1 1", "0 6 9 1 1",
        "0 7 6 1 1", "0 7 8 1 1",
        "0 8 7 1 1",
        "1 10 11 2 2"
      ]
    },
    
    // Clean/Sparkle: cyan
    clean: {
      palette: ["#06FFA5", "#FFD700", "#FFFFFF"],
      pixels: [
        "0 7 1 2 2",
        "0 7 13 2 2",
        "0 1 7 2 2",
        "0 13 7 2 2",
        "1 6 6 4 4",
        "2 7 7 2 2"
      ]
    }
  },

  /**
   * Build an SVG element for the given icon name
   */
  render(name, opts = {}) {
    const def = this.ICONS[name];
    if (!def) {
      console.warn('[PixelIcons] Unknown icon:', name);
      return null;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'pixel-icon pixel-icon-' + name);
    svg.setAttribute('width', opts.size || 16);
    svg.setAttribute('height', opts.size || 16);
    svg.setAttribute('shape-rendering', 'crispEdges');
    
    for (const p of def.pixels) {
      const parts = p.split(' ').map(Number);
      const [paletteIdx, x, y, w, h] = parts;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      rect.setAttribute('fill', def.palette[paletteIdx]);
      svg.appendChild(rect);
    }
    return svg;
  },

  /**
   * Inline SVG string
   */
  inline(name, size = 16) {
    const def = this.ICONS[name];
    if (!def) return '';
    const rects = def.pixels.map(p => {
      const parts = p.split(' ').map(Number);
      const [paletteIdx, x, y, w, h] = parts;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${def.palette[paletteIdx]}"/>`;
    }).join('');
    return `<svg viewBox="0 0 16 16" class="pixel-icon pixel-icon-${name}" width="${size}" height="${size}" shape-rendering="crispEdges">${rects}</svg>`;
  },

  TAG_MAP: {
    '[SQUID]': 'squid',
    '[TEMPLE]': 'temple',
    '[STATS]': 'stats',
    '[CPU]': 'cpu',
    '[TASKS]': 'tasks',
    '[TARGET]': 'target',
    '[LOGS]': 'logs',
    '[MODELS]': 'models',
    '[POSEIDON]': 'poseidon',
    '[BRAIN]': 'brain',
    '[CREATE]': 'create',
    '[CONFIG]': 'config',
    '[OCEAN]': 'ocean',
    '[INTERACT]': 'interact',
    '[CLEAN]': 'clean',
    '[OK]': 'ok',
    '[ERROR]': 'error',
    '[INFO]': 'info',
    '[LAUNCH]': 'launch',
    '[MOUSE]': 'mouse',
    '[DATA]': 'data',
    '[SYSTEM]': 'system'
  },

  replaceTags(rootEl) {
    rootEl = rootEl || document.body;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.tagName === 'SCRIPT') continue;
      if (node.parentElement && node.parentElement.tagName === 'STYLE') continue;
      if (/\[[A-Z]+\]/.test(node.nodeValue)) {
        textNodes.push(node);
      }
    }
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      const fragments = text.split(/(\[[A-Z]+\])/);
      const wrapper = document.createElement('span');
      wrapper.className = 'pixel-icon-text';
      let replaced = false;
      for (const frag of fragments) {
        if (this.TAG_MAP[frag]) {
          const icon = this.render(this.TAG_MAP[frag]);
          if (icon) { wrapper.appendChild(icon); replaced = true; continue; }
        }
        if (frag) wrapper.appendChild(document.createTextNode(frag));
      }
      if (replaced) textNode.parentNode.replaceChild(wrapper, textNode);
    }
  }
};

function initIcons() {
  PixelIcons.replaceTags(document.body);
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) PixelIcons.replaceTags(n);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('[OK] PixelIcons initialized -', Object.keys(PixelIcons.TAG_MAP).length, 'icon mappings');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIcons);
} else {
  initIcons();
}

window.PixelIcons = PixelIcons;
