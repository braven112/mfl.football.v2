# Auction Predictor - Mobile Responsiveness Test Plan

## Overview
Manual testing checklist for auction predictor responsive design across mobile, tablet, and desktop viewports.

**Test Date:** 2026-01-04
**Tester:** _____________
**Page:** `/theleague/auction-predictor`

---

## Test Viewports

### 1. Mobile - 320px (iPhone SE)
**Expected Behavior:**
- [ ] Control panel stacks vertically
- [ ] Dynasty/Redraft weight slider is full width
- [ ] Player table switches to card view (one card per player)
- [ ] Search/filter inputs stack vertically
- [ ] Budget planner switches to single-column layout
- [ ] Market analysis cards stack vertically
- [ ] All text remains readable (no overflow)
- [ ] Touch targets are at least 44x44px
- [ ] No horizontal scroll

**Files to Check:**
- `src/components/theleague/AuctionControlPanel.astro`
- `src/components/theleague/AuctionPlayerTable.astro`
- `src/components/theleague/BudgetPlannerPanel.astro`

**CSS Media Query:**
```css
@media (max-width: 640px) {
  /* Mobile styles */
}
```

---

### 2. Tablet - 768px (iPad)
**Expected Behavior:**
- [ ] Control panel uses 2-column layout
- [ ] Player table shows condensed columns (name, position, price, age)
- [ ] Budget planner uses 2-column grid
- [ ] Market analysis uses 2-column card layout
- [ ] Filters display inline (horizontal)
- [ ] No critical information hidden
- [ ] Touch-friendly spacing maintained

**Files to Check:**
- `src/components/theleague/AuctionControlPanel.astro`
- `src/components/theleague/BudgetPlannerPanel.astro`
- `src/components/theleague/MarketAnalysisDashboard.astro`

**CSS Media Query:**
```css
@media (min-width: 641px) and (max-width: 1024px) {
  /* Tablet styles */
}
```

---

### 3. Desktop - 1024px+
**Expected Behavior:**
- [ ] Full table layout with all columns visible
- [ ] Control panel uses horizontal layout
- [ ] Budget planner uses 3-4 column grid
- [ ] Market analysis uses full dashboard layout
- [ ] Filters display inline with full labels
- [ ] Optimal use of screen real estate
- [ ] All features easily accessible

**CSS Media Query:**
```css
@media (min-width: 1025px) {
  /* Desktop styles */
}
```

---

## Component-Specific Tests

### AuctionControlPanel.astro
- [ ] **Mobile (320px):**
  - Dynasty weight slider full width
  - Filter dropdowns stack vertically
  - Search input full width
  - Buttons stack or use icon-only mode

- [ ] **Tablet (768px):**
  - Controls use 2-column grid
  - Slider and search on same row
  - Filters inline with icons

- [ ] **Desktop (1024px+):**
  - All controls on single row
  - Full labels visible
  - Optimal spacing

### AuctionPlayerTable.astro
- [ ] **Mobile (320px):**
  - Card view (not table)
  - Each card shows: Player name, Position, Price, Age
  - Cards stack vertically
  - Touch-friendly spacing between cards

- [ ] **Tablet (768px):**
  - Table view with condensed columns
  - Hide less critical columns (contract years, team)
  - Sortable headers still work

- [ ] **Desktop (1024px+):**
  - Full table with all columns
  - Optimal column widths
  - Smooth scrolling for 300+ rows

### BudgetPlannerPanel.astro
- [ ] **Mobile (320px):**
  - Single column layout
  - Each budget item stacks vertically
  - Full-width action buttons

- [ ] **Tablet (768px):**
  - 2-column grid
  - Compact but readable

- [ ] **Desktop (1024px+):**
  - 3-4 column grid
  - All details visible

### MarketAnalysisDashboard.astro
- [ ] **Mobile (320px):**
  - Cards stack vertically
  - Charts scale to container width
  - Touch-friendly interactive elements

- [ ] **Tablet (768px):**
  - 2-column card layout
  - Charts maintain aspect ratio

- [ ] **Desktop (1024px+):**
  - Full dashboard grid
  - Multiple charts side-by-side

---

## Cross-Browser Testing

Test on the following browsers at each viewport size:

### Desktop Browsers
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

### Mobile Browsers
- [ ] iOS Safari (iPhone SE, iPhone 14)
- [ ] Chrome Android (Pixel, Samsung)
- [ ] Samsung Internet

---

## Performance Considerations

- [ ] Page loads in < 3 seconds on 3G connection
- [ ] Smooth scrolling (60 FPS) on mobile devices
- [ ] Touch interactions feel responsive (< 100ms delay)
- [ ] No layout shift during loading
- [ ] Images/icons load progressively

---

## Accessibility Checks

- [ ] All interactive elements keyboard accessible
- [ ] Touch targets meet WCAG 2.1 (44x44px minimum)
- [ ] Text contrast meets WCAG AA standards
- [ ] Screen reader can navigate all content
- [ ] Focus indicators visible on all interactive elements

---

## Common Issues to Watch For

### Layout Issues
- Horizontal scrollbars on mobile
- Text overflow/truncation
- Overlapping elements
- Hidden critical information
- Broken grid layouts

### Interaction Issues
- Touch targets too small
- Accidental clicks due to proximity
- Unresponsive buttons
- Broken dropdowns/modals on mobile
- Scroll conflicts (table vs page)

### Visual Issues
- Inconsistent spacing
- Misaligned elements
- Font sizes too small (< 16px body text)
- Poor color contrast
- Broken responsive images

---

## Test Execution Log

| Viewport | Browser | Status | Issues Found | Fixed? |
|----------|---------|--------|--------------|--------|
| 320px | Chrome | ⏳ Pending | - | - |
| 320px | iOS Safari | ⏳ Pending | - | - |
| 768px | Chrome | ⏳ Pending | - | - |
| 768px | iPad Safari | ⏳ Pending | - | - |
| 1024px+ | Chrome | ⏳ Pending | - | - |
| 1024px+ | Firefox | ⏳ Pending | - | - |

---

## Automated Responsive Checks

Run the following command to check for common responsive issues:

```bash
# Check for viewport meta tag
grep -r "viewport" src/pages/theleague/auction-predictor.astro

# Check for media queries in components
grep -r "@media" src/components/theleague/Auction*.astro src/components/theleague/Budget*.astro

# Check for fixed widths that might break responsive design
grep -r "width: [0-9]" src/components/theleague/Auction*.astro | grep -v "max-width\|min-width\|100%"
```

---

## Sign-Off

**Tested By:** _____________
**Date:** _____________
**Status:** ⏳ Pending / ✅ Passed / ❌ Failed

**Notes:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________
