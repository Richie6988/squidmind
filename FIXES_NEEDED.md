# CRITICAL FIXES NEEDED

## PRIORITY 1 - CORE BROKEN FEATURES

### 1. SQUID CLICK NOT WORKING
- Console shows "Entity at click: none" even when clicking squids
- isPointOver method exists but not being called correctly
- Need to verify squid positions and hit detection

### 2. MODEL LOADING BROKEN
- Error: "path must be string, received undefined"
- ModelScanner not passing path correctly
- Need to fix the entire model loading flow

### 3. COLOR/OUTFIT CHANGES NO EFFECT
- Changing squid color in edit panel → no visual change
- Need to force squid redraw after property update
- Update aquarium rendering

### 4. LEFT CLICK SHOULD OPEN DETAIL PANEL
- Currently might show context menu instead
- Need single click → detail panel
- Right click → context menu (Feed/Play/etc)

## FIXES TO APPLY

1. Squid Click Detection:
   - Add debug logging to isPointOver
   - Check if squid.x, squid.y are correct
   - Verify hit detection radius

2. Model Loading:
   - Remove ModelScanner complexity
   - Simple model list in Models panel
   - Dropdown in Poseidon from that list

3. Color Updates:
   - After editing squid → call squid.updateColor()
   - Force canvas redraw
   - Save to backend

4. Simplify UI:
   - Remove broken features
   - Keep only what works
   - Clean up panels
