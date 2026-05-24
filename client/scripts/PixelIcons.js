/**
 * PixelIcons - Hand-crafted 16x16 pixel art icons
 * 
 * Each icon is built from <rect> elements at integer coordinates.
 * Uses shape-rendering: crispEdges for sharp pixels at any size.
 * Single color via currentColor for theming.
 * 
 * To use:
 *   const svg = PixelIcons.render('squid');  -> returns SVG element
 *   PixelIcons.replaceTags(rootElement);     -> swap [TAG] text with icons
 */

const PixelIcons = {
  /**
   * Each icon is an array of "pixels" defined as:
   *   "x y w h"  meaning rect at (x,y) of width w, height h
   * 16x16 grid where pixels are 1x1 by default.
   * Larger rects are how we draw thick lines / blocks.
   */
  PIXELS: {
    // System / Gear (8 teeth around center hole)
    system: [
      "7 1 2 2", "7 13 2 2", "1 7 2 2", "13 7 2 2",
      "2 2 2 2", "12 2 2 2", "2 12 2 2", "12 12 2 2",
      "4 4 8 8",
      "6 6 4 4"  // hole (will be cut with mask)
    ],
    
    // CPU chip
    cpu: [
      // Pins top
      "3 0 2 2", "7 0 2 2", "11 0 2 2",
      // Pins bottom  
      "3 14 2 2", "7 14 2 2", "11 14 2 2",
      // Pins left
      "0 3 2 2", "0 7 2 2", "0 11 2 2",
      // Pins right
      "14 3 2 2", "14 7 2 2", "14 11 2 2",
      // Body outline
      "2 2 12 2", "2 12 12 2", "2 2 2 12", "12 2 2 12",
      // Inner detail
      "6 6 4 4"
    ],
    
    // Squid (head + tentacles + eyes)
    squid: [
      // Head
      "5 1 6 6",
      "4 2 8 4",
      // Eyes
      "6 3 1 1", "9 3 1 1",
      // Body curve
      "3 6 10 2",
      // Tentacles
      "3 8 2 6", "6 8 2 6", "9 8 2 6", "12 8 2 6",
      // Tentacle tips wider
      "2 12 2 2", "5 12 2 2", "8 12 2 2", "11 12 2 2"
    ],
    
    // Temple (Greek style with triangle pediment and pillars)
    temple: [
      // Pediment (triangle)
      "7 1 2 1",
      "6 2 4 1",
      "5 3 6 1",
      "4 4 8 1",
      // Architrave
      "3 5 10 1",
      "2 6 12 1",
      // Pillars
      "3 7 2 7",
      "7 7 2 7",
      "11 7 2 7",
      // Base
      "2 14 12 2"
    ],
    
    // Trident (Poseidon)
    poseidon: [
      // Prongs
      "3 1 2 5", "7 1 2 5", "11 1 2 5",
      // Crossbar
      "2 6 12 2",
      // Shaft
      "7 8 2 7"
    ],
    
    // Brain (rounded with center division)
    brain: [
      "5 2 6 1",
      "3 3 4 1", "9 3 4 1",
      "2 4 4 1", "10 4 4 1",
      "2 5 5 1", "9 5 5 1",
      "1 6 6 4", "9 6 6 4",
      "2 10 5 1", "9 10 5 1",
      "3 11 4 1", "9 11 4 1",
      "4 12 3 1", "9 12 3 1",
      "5 13 6 1"
    ],
    
    // Chart bars (stats)
    stats: [
      "2 14 2 2",   // axes
      "2 2 1 12",
      "4 11 2 3",
      "7 8 2 6",
      "10 5 2 9",
      "13 2 2 12"
    ],
    
    // Tasks (checklist)
    tasks: [
      // Box 1
      "1 1 4 4", "5 2 1 1", "4 3 1 1", "3 4 1 1",  // checked
      // Line 1
      "7 2 8 2",
      // Box 2
      "1 6 4 4", "5 7 1 1", "4 8 1 1", "3 9 1 1",  // checked
      // Line 2
      "7 7 8 2",
      // Box 3 (empty)
      "1 11 4 1", "1 12 1 2", "4 12 1 2", "1 14 4 1",
      // Line 3
      "7 12 8 2"
    ],
    
    // Target (bullseye)
    target: [
      "5 1 6 1", "3 2 2 1", "11 2 2 1",
      "2 3 1 1", "13 3 1 1",
      "1 4 1 2", "14 4 1 2",
      "1 6 1 4", "14 6 1 4",
      "5 6 6 1", "5 9 6 1",
      "5 7 1 2", "10 7 1 2",
      "7 7 2 2",  // bullseye
      "1 10 1 2", "14 10 1 2",
      "2 12 1 1", "13 12 1 1",
      "3 13 2 1", "11 13 2 1",
      "5 14 6 1"
    ],
    
    // Wrench (config)
    config: [
      "10 1 3 3", "9 2 1 2",
      "9 4 3 1", "8 5 3 1",
      "7 6 3 1", "6 7 3 1",
      "5 8 3 1", "4 9 3 1",
      "3 10 3 1", "2 11 3 1",
      "1 12 3 3", "3 13 1 1"
    ],
    
    // Plus (create)
    plus: [
      "7 2 2 12",
      "2 7 12 2"
    ],
    
    // Document / scroll (logs)
    logs: [
      "3 1 9 1",
      "3 2 1 13", "11 2 1 13",
      "3 14 9 1",
      "5 4 5 1",
      "5 6 5 1",
      "5 8 5 1",
      "5 10 5 1",
      "5 12 3 1"
    ],
    
    // Team (3 figures)
    team: [
      // Person 1
      "3 3 2 2", "2 5 4 3",
      // Person 2 (center, taller)
      "7 1 2 2", "6 3 4 5",
      // Person 3
      "11 3 2 2", "10 5 4 3",
      // Base
      "1 9 14 2"
    ],
    
    // Models (stacked boxes)
    models: [
      "2 2 12 3",
      "2 6 12 3",
      "2 10 12 3",
      // dots
      "4 3 1 1", "4 7 1 1", "4 11 1 1"
    ],
    
    // Database (data)
    data: [
      "3 1 10 2",
      "2 3 12 2",
      "3 5 10 1",
      "3 7 10 1",
      "3 9 10 1",
      "3 11 10 1",
      "2 13 12 2",
      "3 15 10 1"
    ],
    
    // Mouse cursor (interact)
    interact: [
      "3 2 1 11",
      "4 3 1 1", "4 5 1 1", "4 7 1 1", "4 9 1 1", "4 11 1 1",
      "5 4 1 1", "5 6 1 1", "5 8 1 1", "5 10 1 1",
      "6 5 1 1", "6 7 1 1", "6 9 1 1",
      "7 6 1 1", "7 8 1 1",
      "8 7 1 1",
      "10 11 2 2", "11 9 1 2", "12 11 1 2"
    ],
    
    // Sparkle (clean/create alt)
    clean: [
      "7 2 2 2",
      "7 12 2 2",
      "2 7 2 2",
      "12 7 2 2",
      "6 6 4 4"
    ],
    
    // Check (ok)
    ok: [
      "12 3 2 2",
      "10 5 2 2",
      "8 7 2 2",
      "6 9 2 2",
      "2 7 2 2", "4 9 2 2"
    ],
    
    // X (error)
    error: [
      "2 2 2 2", "4 4 2 2", "6 6 2 2", "8 8 2 2", "10 10 2 2", "12 12 2 2",
      "12 2 2 2", "10 4 2 2", "8 6 2 2", "6 8 2 2", "4 10 2 2", "2 12 2 2"
    ],
    
    // Info (i in circle)
    info: [
      "5 1 6 1", "3 2 2 1", "11 2 2 1",
      "2 3 1 2", "13 3 1 2",
      "1 5 1 6", "14 5 1 6",
      "2 11 1 2", "13 11 1 2",
      "3 13 2 1", "11 13 2 1",
      "5 14 6 1",
      // i
      "7 4 2 2",
      "7 7 2 6"
    ],
    
    // Rocket (launch)
    launch: [
      "7 1 2 2",
      "6 3 4 2",
      "5 5 6 4",
      "6 9 1 3",
      "9 9 1 3",
      "4 9 2 4",
      "10 9 2 4",
      "7 12 2 2"
    ],
    
    // Wave (ocean)
    ocean: [
      "1 5 2 1", "3 4 2 1", "5 5 2 1", "7 4 2 1", "9 5 2 1", "11 4 2 1", "13 5 2 1",
      "1 9 2 1", "3 8 2 1", "5 9 2 1", "7 8 2 1", "9 9 2 1", "11 8 2 1", "13 9 2 1",
      "1 13 2 1", "3 12 2 1", "5 13 2 1", "7 12 2 1", "9 13 2 1", "11 12 2 1", "13 13 2 1"
    ],
    
    // Egg (create new agent)
    create: [
      "6 1 4 1",
      "5 2 6 1",
      "4 3 8 3",
      "3 6 10 7",
      "4 13 8 1",
      "5 14 6 1"
    ],
    
    // Mouse pointer arrow
    mouse: [
      "3 2 1 11",
      "4 3 2 1", "4 5 2 1", "4 7 2 1", "4 9 2 1", "4 11 2 1",
      "6 4 2 1", "6 6 2 1", "6 8 2 1", "6 10 2 1",
      "8 5 2 1", "8 7 2 1", "8 9 2 1",
      "10 6 1 1", "10 8 1 1",
      "11 12 2 2", "12 10 1 2"
    ]
  },

  /**
   * Build an SVG element for the given icon name
   */
  render(name, opts = {}) {
    const pixels = this.PIXELS[name];
    if (!pixels) {
      console.warn('[PixelIcons] Unknown icon:', name);
      return null;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'pixel-icon pixel-icon-' + name);
    svg.setAttribute('width', opts.size || 16);
    svg.setAttribute('height', opts.size || 16);
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('fill', 'currentColor');

    for (const def of pixels) {
      const [x, y, w, h] = def.split(' ').map(Number);
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      svg.appendChild(rect);
    }

    return svg;
  },

  /**
   * Get inline SVG string (for use in template literals / innerHTML)
   */
  inline(name, size = 16) {
    const pixels = this.PIXELS[name];
    if (!pixels) return '';
    const rects = pixels.map(def => {
      const [x, y, w, h] = def.split(' ').map(Number);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
    }).join('');
    return `<svg viewBox="0 0 16 16" class="pixel-icon pixel-icon-${name}" width="${size}" height="${size}" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
  },

  /**
   * Map from old [TAG] text to icon name
   */
  TAG_MAP: {
    '[SQUID]': 'squid',
    '[TEMPLE]': 'temple',
    '[STATS]': 'stats',
    '[CPU]': 'cpu',
    '[TASKS]': 'tasks',
    '[TARGET]': 'target',
    '[LOGS]': 'logs',
    '[TEAM]': 'team',
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

  /**
   * Replace all [TAG] text in element with SVG icons
   */
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
          if (icon) {
            wrapper.appendChild(icon);
            replaced = true;
            continue;
          }
        }
        if (frag) {
          wrapper.appendChild(document.createTextNode(frag));
        }
      }
      if (replaced) {
        textNode.parentNode.replaceChild(wrapper, textNode);
      }
    }
  }
};

// Run replacement when DOM ready
function initIcons() {
  PixelIcons.replaceTags(document.body);
  // Watch for new content added later (panels opening, dynamic content)
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) PixelIcons.replaceTags(node);
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
