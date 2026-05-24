# PRODUCTION LEVEL TEST CHECKLIST

## CRITICAL FIXES
- [ ] ui.showPanel works (no "ui is not defined" error)
- [ ] Panels can be opened (Models, Teams, Scheduler)
- [ ] No infinite recursion when clicking squids
- [ ] Squid click shows bounce animation
- [ ] Detail panel opens correctly

## PANEL RESIZING
- [ ] Can drag RIGHT edge of panel to resize width
- [ ] Can drag BOTTOM edge of panel to resize height  
- [ ] Can drag CORNER (SE) to resize both
- [ ] Minimum size enforced (250px x 200px)
- [ ] Resize handles visible on hover
- [ ] Cursor changes appropriately
- [ ] Panels maintain position during resize

## CRON BUILDER
- [ ] Opens INSIDE temple interior (not browser popup)
- [ ] Shows above temple content (z-index correct)
- [ ] All frequency options work:
  - [ ] Every Minute
  - [ ] Every 5/15/30 Minutes
  - [ ] Hourly
  - [ ] Daily (with time picker)
  - [ ] Weekly (with day selector)
  - [ ] Monthly (with date selector)
  - [ ] Custom (manual cron input)
- [ ] Preview updates in real-time
- [ ] Cron expression shown and correct
- [ ] Save creates REAL task
- [ ] Task appears in cron tasks list
- [ ] Cancel closes modal

## SQUID ASSIGNMENT
- [ ] "Assign Squids" button works
- [ ] Modal shows all available squids
- [ ] Can click to assign squid
- [ ] Backend API called (/api/agents/assign)
- [ ] Squid appears in working agents list
- [ ] Button changes to "Assigned" after assignment
- [ ] Error handling works (rollback on failure)

## TEMPLE INTERIOR
- [ ] Temple opens without errors
- [ ] Input resources section visible
- [ ] Output resources section visible
- [ ] project_memory.json button works
- [ ] Working agents section shows assigned squids
- [ ] IDE workspace functional
- [ ] KANBAN board displays
- [ ] Cron tasks section displays

## NO ERRORS
- [ ] No console errors on page load
- [ ] No errors when clicking nav buttons
- [ ] No errors when clicking squids
- [ ] No errors opening temple
- [ ] No errors creating cron tasks
- [ ] No errors assigning squids

Run: npm start
Test each item above
Mark [x] when verified working
