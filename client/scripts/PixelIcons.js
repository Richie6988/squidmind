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
    
    // Temple: warm marble sand, gold pediment trim, dark ground
    temple: {
      palette: ["#E5C580", "#FFD700", "#7A6E55", "#3A2E1F"],
      pixels: [
        // Pediment (triangular, sand colored)
        "0 7 0 2 1", "0 6 1 4 1", "0 5 2 6 1", "0 4 3 8 1", "0 3 4 10 1",
        // Architrave: gold band sandwiched between sand bands
        "1 2 5 12 1", "0 2 6 12 1",
        // Three columns
        "0 2 7 2 7", "0 7 7 2 7", "0 12 7 2 7",
        // Column right-edge shadows
        "2 3 7 1 7", "2 8 7 1 7", "2 13 7 1 7",
        // Stylobate (upper step) + dark ground
        "0 1 14 14 1", "3 0 15 16 1"
      ]
    },
    
    // Poseidon trident: 3 clear prongs, S-curl, decorated grip with jewel
    poseidon: {
      palette: ["#FFD700", "#B8860B", "#FFA500"],
      pixels: [
        // Outer prong tips
        "0 3 1 1 3", "0 12 1 1 3",
        // Center prong (taller, runs from top into yoke)
        "0 7 0 2 7",
        // Curl from outer prongs into yoke (S-shape)
        "0 4 3 1 1", "0 4 4 1 2", "0 5 5 1 1",
        "0 11 3 1 1", "0 11 4 1 2", "0 10 5 1 1",
        // Yoke connecting all three prongs at top of shaft
        "0 5 6 7 1",
        // Shaft
        "0 7 7 2 5",
        // Decorated grip with orange jewel
        "0 6 12 4 1",
        "1 6 13 1 1", "2 7 13 2 1", "1 9 13 1 1",
        "0 6 14 4 1",
        // Shaft tail below grip
        "0 7 15 2 1",
        // Subtle right-side shadow for depth
        "1 8 8 1 4"
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
    
    // Stats: ascending bars in brand palette (cyan → blue → deep → pink → gold)
    stats: {
      palette: ["#7DD3FC", "#3B82F6", "#1A4D7A", "#FF6B9D", "#FFD700"],
      pixels: [
        // y-axis (deep blue, doubles as axis color)
        "2 1 2 1 12",
        // x-axis
        "2 1 14 15 1",
        // bars (left → right, short → tall, ending on gold for "growth")
        "0 3 12 2 2",   // cyan
        "1 5 10 2 4",   // mid blue
        "2 7 8 2 6",    // deep blue
        "3 9 6 2 8",    // squid pink
        "4 11 3 2 11"   // gold (tallest)
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
    
    // Config: 8-toothed gear with gold center pixel (universal settings symbol)
    config: {
      palette: ["#C0C0C0", "#606060", "#FFD700"],
      pixels: [
        // Four cardinal teeth (N, S, W, E)
        "0 6 0 4 3", "0 6 13 4 3",
        "0 0 6 3 4", "0 13 6 3 4",
        // Four diagonal teeth
        "0 2 2 2 2", "0 12 2 2 2", "0 2 12 2 2", "0 12 12 2 2",
        // Outer disc (silver)
        "0 3 3 10 10",
        // Inner well (darker silver)
        "1 4 4 8 8",
        // Inner disc back to silver
        "0 5 5 6 6",
        // Gold center pixel
        "2 7 7 2 2"
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
    // Brain: branching coral fan with neural sparkles (marine + neural network metaphor)
    brain: {
      palette: ["#FF6B9D", "#C44569", "#FFFFFF"],
      // 0=coral pink (branches), 1=darker pink (base shadow), 2=white (synapse sparkles)
      pixels: [
        // Synapse sparkles at branch tips
        "2 6 1 1 1", "2 10 1 1 1",
        // Top branches (4 antlers spreading outward)
        "0 4 2 3 1", "0 8 2 3 1",
        "0 3 3 1 1", "0 6 3 1 1", "0 8 3 1 1", "0 11 3 1 1",
        // Spreading wider
        "0 2 4 1 1", "0 13 4 1 1",
        "0 2 5 2 1", "0 6 5 1 1", "0 8 5 1 1", "0 12 5 2 1",
        // Merge layer — branches converging
        "0 3 6 9 1",
        "0 4 7 7 1",
        "0 5 8 3 1",
        // Trunk
        "0 5 9 3 2",
        // Base / coral foot (darker pink, expanding)
        "1 4 11 5 1",
        "1 3 12 7 1",
        "1 2 13 9 1",
        "1 1 14 11 1"
      ]
    },
    
    // Logs: Greek parchment scroll — rolled ends + ink lines
    logs: {
      palette: ["#F5E6D0", "#8B4513", "#3A2E1F"],
      // 0=parchment cream, 1=rolled-end brown, 2=ink
      pixels: [
        // Top roller (with shaved corners for cylindrical hint)
        "1 1 1 14 1",
        "1 0 2 16 1",
        // Parchment body
        "0 0 3 16 10",
        // Ink lines (3 full + 1 short paragraph end)
        "2 2 4 12 1",
        "2 2 6 12 1",
        "2 2 8 12 1",
        "2 2 10 8 1",
        // Bottom roller (mirror)
        "1 0 13 16 1",
        "1 1 14 14 1"
      ]
    },
    
    // Team: 3 colored people
    // Team: school of 3 fish swimming right in brand colors
    team: {
      palette: ["#FF6B9D", "#3B82F6", "#06FFA5"],
      // 0=squid pink (lead fish), 1=ocean blue (mid), 2=seafoam (rear)
      pixels: [
        // Fish A — pink, top-left, leading
        "0 1 1 1 1",           // tail fin
        "0 2 0 1 1",           // tail top edge
        "0 2 2 1 1",           // tail bottom edge
        "0 3 1 4 1", "0 3 2 4 1",  // body rows
        "0 7 1 1 1",           // snout top
        "0 7 2 1 1",           // snout bottom
        // Fish B — blue, middle
        "1 5 6 1 1",
        "1 6 5 1 1", "1 6 7 1 1",
        "1 7 6 4 1", "1 7 7 4 1",
        "1 11 6 1 1", "1 11 7 1 1",
        // Fish C — seafoam, rear/bottom
        "2 9 11 1 1",
        "2 10 10 1 1", "2 10 12 1 1",
        "2 11 11 4 1", "2 11 12 4 1",
        "2 15 11 1 1", "2 15 12 1 1"
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
    
    // Ocean: foam-crested wave with water-depth layers below
    ocean: {
      palette: ["#7DD3FC", "#3B82F6", "#1A4D7A", "#FFFFFF"],
      pixels: [
        // Foam crest (white)
        "3 5 2 5 1",
        // Wave body widening down (light cyan with foam edges)
        "3 3 3 2 1", "0 5 3 5 1", "3 10 3 2 1",
        "3 2 4 1 1", "0 3 4 10 1", "3 13 4 1 1",
        "3 1 5 1 1", "0 2 5 12 1", "3 14 5 1 1",
        // Water surface (full row of light cyan)
        "0 0 6 16 1",
        // Mid-blue band
        "1 0 7 16 3",
        // Alternating depth (deep + mid)
        "2 0 10 16 1", "1 0 11 16 1",
        "2 0 12 16 1", "1 0 13 16 1",
        "2 0 14 16 1", "1 0 15 16 1"
      ]
    },
    
    // Launch: paper boat with white sail, squid-pink hull, rippled water
    launch: {
      palette: ["#FFFFFF", "#FF6B9D", "#3B82F6", "#C44569"],
      pixels: [
        // Sail (triangle pointing up)
        "0 8 2 1 1",
        "0 7 3 3 1",
        "0 6 4 5 1",
        "0 5 5 7 1",
        "0 4 6 9 1",
        "0 3 7 11 1",
        "0 2 8 13 1",
        // Hull (pink, tapers)
        "1 0 9 16 1",
        "1 1 10 14 1",
        "1 2 11 12 1",
        "1 3 12 10 1",
        // Hull bow + stern outlines (darker pink)
        "3 0 9 1 1", "3 15 9 1 1",
        // Water ripples
        "2 1 14 1 1", "2 3 14 1 1", "2 5 14 1 1", "2 7 14 1 1", "2 9 14 1 1", "2 11 14 1 1", "2 13 14 1 1",
        // Water base line
        "2 0 15 16 1"
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

    // TEXT model — speech bubble with lines
    text_model: {
      palette: ['#4facfe','#0a1628','#7dd3fc'],
      pixels: [
        '0 2 1 12 9','1 3 2 10 7',
        '2 4 3 8 1','2 4 5 8 1','2 4 7 6 1',
        '0 4 10 2 2','0 5 12 1 1'
      ]
    },

    // VLM — eye inside viewfinder
    vlm: {
      palette: ['#34d399','#022c1a','#a7f3d0','#065f46'],
      pixels: [
        '0 1 4 14 1','0 1 11 14 1','0 1 4 1 8','0 14 4 1 8',
        '0 4 6 8 4','1 5 7 6 2','2 7 7 2 2',
        '3 6 8 1 1','3 9 8 1 1'
      ]
    },

    // TOOLS — wrench pixel
    tools: {
      palette: ['#f59e0b','#7c2d00','#fde68a'],
      pixels: [
        '0 2 1 4 4','0 2 2 2 2','2 3 3 2 1',
        '0 4 5 8 8','0 5 6 6 6','1 6 7 4 4',
        '0 10 9 4 4','0 11 10 2 2','0 12 11 2 2','0 13 12 2 2'
      ]
    },

    // THINK — air bubble (thought = bubble underwater, double brand metaphor)
    think: {
      palette: ['#7DD3FC', '#1E40AF', '#FFFFFF'],
      pixels: [
        // Big bubble outline
        '1 5 1 6 1',
        '1 3 2 2 1', '1 11 2 2 1',
        '1 2 3 1 1', '1 13 3 1 1',
        '1 1 4 1 5', '1 14 4 1 5',
        '1 2 9 1 1', '1 13 9 1 1',
        '1 3 10 2 1', '1 11 10 2 1',
        '1 5 11 6 1',
        // Bubble body (light cyan)
        '0 5 2 6 1',
        '0 3 3 10 1',
        '0 2 4 12 5',
        '0 3 9 10 1',
        '0 5 10 6 1',
        // White highlight (upper-left curve)
        '2 3 4 2 2',
        // Trailing smaller bubble
        '1 11 13 2 2',
        // Tiny bubble at the very tail
        '1 14 15 1 1'
      ]
    },

    // CODE — </>  
    code_model: {
      palette: ['#00ffb4','#003d29','#00cc90'],
      pixels: [
        '0 1 5 3 1','0 1 6 2 1','0 1 7 2 1','0 1 8 3 1',
        '0 3 6 2 2','0 4 8 1 1',
        '2 7 4 2 1','2 8 5 2 1','2 8 7 2 1','2 7 8 2 1',
        '0 12 5 3 1','0 13 6 2 1','0 13 7 2 1','0 12 8 3 1',
        '0 10 6 2 2','0 11 8 1 1'
      ]
    },

    // EMBED — grid of dots
    embed: {
      palette: ['#94a3b8','#1e293b','#cbd5e1'],
      pixels: [
        '0 2 2 2 2','0 7 2 2 2','0 12 2 2 2',
        '0 2 7 2 2','2 7 7 2 2','0 12 7 2 2',
        '0 2 12 2 2','0 7 12 2 2','0 12 12 2 2',
        '1 4 4 8 8'
      ]
    },

    // MATH — sigma symbol
    math_model: {
      palette: ['#fb923c','#431407','#fed7aa'],
      pixels: [
        '0 2 1 12 2','2 3 2 9 1',
        '0 4 4 5 2','0 3 6 6 2',
        '0 4 10 5 2','2 3 11 9 1',
        '0 2 12 12 2'
      ]
    },

    // IMAGE — landscape in frame
    image_model: {
      palette: ['#a78bfa','#2e1065','#7c3aed','#ddd6fe','#86efac'],
      pixels: [
        '0 1 1 14 14','1 2 2 12 12',
        '4 3 8 4 5','4 4 9 2 4','4 5 10 1 3',
        '3 8 5 2 3','3 9 6 1 2',
        '2 3 3 1 1','0 4 4 1 1'
      ]
    },

    // BOLT — simple bright zigzag lightning (active squad)
    bolt: {
      palette: ['#facc15','#fef9c3','#000000'],
      pixels: [
        '0 9 1 4 2','0 8 3 4 2','0 7 5 4 2',
        '0 4 5 8 2',
        '0 7 7 7 2','0 6 9 7 2','0 5 11 7 2',
        '0 3 11 5 2','0 2 13 5 2',
        '1 10 2 2 2','1 9 4 2 2'
      ]
    },

    // MOON — clear crescent shape (sleeping squad)
    moon: {
      palette: ['#94a3b8','#e2e8f0','#1e293b'],
      pixels: [
        '0 4 1 8 14',
        '2 5 2 6 12',
        '2 6 3 4 10',
        '2 7 4 2 8',
        '2 8 5 2 6',
        '2 8 6 2 4',
        '2 8 7 2 2',
        '1 6 1 4 2','1 6 13 4 2',
        '1 9 3 2 2','1 10 5 2 2','1 10 7 2 2','1 10 9 2 2','1 9 11 2 2'
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
    '[SYSTEM]': 'system',
    '[TEXT]': 'text_model',
    '[VLM]': 'vlm',
    '[TOOLS]': 'tools',
    '[THINK]': 'think',
    '[CODE]': 'code_model',
    '[EMBED]': 'embed',
    '[MATH]': 'math_model',
    '[IMAGE]': 'image_model',
    '[BOLT]': 'bolt',
    '[MOON]': 'moon'
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
