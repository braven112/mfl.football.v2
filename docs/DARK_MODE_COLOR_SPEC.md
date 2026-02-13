# Dark Mode Color Specification

> **For the designer:** The "Dark Mode" column has been pre-filled based on the reference screenshot.
> Review and adjust as needed. The "Light Mode" column shows the current value for comparison.
>
> **Reference screenshot:** MFL dark-themed standings page with dark charcoal surfaces, gold accents, and light gray text.
>
> **Notes:**
> - Use hex values (e.g., `#1a1a2e`) or rgba (e.g., `rgba(255,255,255,0.1)`)
> - Surfaces use elevation-based brightness (darker = lower, lighter = higher)
> - Text needs WCAG AA contrast (4.5:1) against its background surface
> - Semantic colors (success, warning, error, info) use muted backgrounds with brighter text in dark mode

---

## 1. Brand Colors

In dark mode the brand colors shift slightly brighter to maintain vibrancy against dark surfaces. The gold accent from the screenshot replaces green as the dark-mode accent.

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Primary** | `#1c497c` | `#1c497c` |
| **Primary Dark** | `#164066` | `#0f2d4a` |
| **Primary Light** | `#2563eb` | `#3b82f6` |
| **Secondary** | `#2e8743` | `#3c9950` |
| **Secondary Dark** | `#26743a` | `#2e8743` |
| **Secondary Light** | `#3c9950` | `#4ade80` |
| **Accent** | `#2e8743` | `#c9a94e` |

---

## 2. Neutral / Gray Scale

The scale effectively inverts for dark mode. Light grays become dark surfaces, dark grays become readable text.

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Gray 50** (lightest) | `#f9fafb` | `#18182a` |
| **Gray 100** | `#f3f4f6` | `#1e1e32` |
| **Gray 200** | `#dddedf` | `#2a2a3d` |
| **Gray 300** | `#d1d5db` | `#3a3a50` |
| **Gray 400** | `#9ca3af` | `#6b6b80` |
| **Gray 500** | `#6b7280` | `#8a8a9a` |
| **Gray 600** | `#4b5563` | `#a0a0b0` |
| **Gray 700** | `#374151` | `#c0c0cc` |
| **Gray 800** | `#1f2937` | `#d8d8e0` |
| **Gray 900** (darkest) | `#111827` | `#ededf0` |

---

## 3. Page & Content Surfaces

Three elevation levels create depth: page (deepest dark), content panels (mid), and accented areas (brightest dark).

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Page Background** | Full page behind everything | `#e0e0e0` | `#121220` |
| **Content Background** | Main content panels | `#ffffff` | `#1e1e32` |
| **Content Background Muted** | Subtle/recessed areas | `#eeeeee` | `#18182a` |
| **Content Background Accent** | Highlighted sections | `#66abea` | `#2a4a6e` |
| **Content Border** | Panel borders | `#e2e8f0` | `#2e2e44` |

---

## 4. Text Colors

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Page Text** (primary) | Main body text | `#111827` | `#e0e0e8` |
| **Text Muted** | Secondary/helper text | `#6b7280` | `#8a8a9a` |

---

## 5. Links

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Link Default** | Standard link text | `#111827` | `#7eb8da` |
| **Link Hover** | Link on hover | `#2e8743` | `#c9a94e` |
| **Link Focus** | Link on focus | `#2e8743` | `#c9a94e` |
| **Link Inverse** | Links on dark backgrounds | `#e2e8f0` | `#e2e8f0` |
| **Link Inverse Hover** | Inverse link hover | `#2e8743` | `#c9a94e` |
| **Link Accent** | Accent-styled links | `#2563eb` | `#60a5fa` |
| **Link Accent Hover** | Accent link hover | `#b45309` | `#d4a44a` |

---

## 6. Buttons

### Primary Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#1c497c` | `#1c497c` |
| **Background Hover** | `#164066` | `#245a94` |
| **Background Focus** | `#164066` | `#245a94` |
| **Text** | `#ffffff` | `#ffffff` |
| **Border** | `#1c497c` | `#2e5f8f` |
| **Border Hover** | `#2e8743` | `#c9a94e` |

### Secondary Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#2e8743` | `#2e8743` |
| **Background Hover** | `#26743a` | `#3c9950` |
| **Background Focus** | `#22663a` | `#3c9950` |
| **Text** | `#ffffff` | `#ffffff` |
| **Border** | `#2e8743` | `#3c9950` |
| **Border Hover** | `#1c497c` | `#c9a94e` |

### Inverse Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#e2e8f0` | `#2a2a3d` |
| **Background Hover** | `#1c497c` | `#1c497c` |
| **Background Focus** | `#1c497c` | `#1c497c` |
| **Text** | `#1f2937` | `#d8d8e0` |
| **Text Hover** | `#ffffff` | `#ffffff` |

### Icon Button
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Text** | `#6b7280` | `#8a8a9a` |
| **Text Focus** | `#3b82f6` | `#60a5fa` |

---

## 7. Cards

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#ffffff` | `#1e1e32` |
| **Border** | `#e2e8f0` | `#2e2e44` |

---

## 8. Tables

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Header Background** | Column headers | `#f9fafb` | `#18182a` |
| **Header Text** | Column header text | `#9ca3af` | `#8a8a9a` |
| **Row Background** | Odd rows | `#ffffff` | `#1e1e32` |
| **Row Background Alt** | Even rows (zebra striping) | `#ececec` | `#232338` |
| **Row Background Hover** | Row on hover | `#f9fafb` | `#2a2a3d` |
| **Table Border** | Cell/row borders | `#e2e8f0` | `#2e2e44` |

---

## 9. Forms

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Input Background** | Text input fill | `#ffffff` | `#18182a` |
| **Input Border** | Input border default | `#d1d5db` | `#3a3a50` |
| **Input Border Focus** | Input border on focus | `#1c497c` | `#3b82f6` |
| **Input Text** | Typed text | `#111827` | `#e0e0e8` |
| **Input Placeholder** | Placeholder text | `#9ca3af` | `#6b6b80` |
| **Input Disabled Background** | Disabled input fill | `#f3f4f6` | `#151526` |

---

## 10. Inverse Sections (Dark Headers/Footers)

The top nav bar and header sections. In dark mode these blend more seamlessly but stay distinct.

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Background** | Dark section fill | `#1c497c` | `#10101c` |
| **Background Accent** | Accent within dark section | `#2e8743` | `#c9a94e` |
| **Border** | Border in dark section | `#164066` | `#1a1a2e` |
| **Text** | Text in dark section | `#ffffff` | `#e0e0e8` |

---

## 11. Accent Content Blocks

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Background** | `#66abea` | `#1c3a5c` |
| **Border** | `#d6e3f0` | `#2a4a6e` |
| **Text** | `#ffffff` | `#e0e0e8` |

---

## 12. Semantic Colors

Dark mode uses translucent/muted backgrounds with brighter foreground text for status indicators.

### Success
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#10b981` | `#34d399` |
| **Light** (badge/alert bg) | `#d1fae5` | `rgba(16, 185, 129, 0.15)` |
| **Dark** (badge/alert text) | `#059669` | `#6ee7b7` |

### Warning
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#f59e0b` | `#fbbf24` |
| **Light** (badge/alert bg) | `#fef3c7` | `rgba(245, 158, 11, 0.15)` |
| **Dark** (badge/alert text) | `#d97706` | `#fcd34d` |

### Error
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#dc2626` | `#f87171` |
| **Light** (badge/alert bg) | `#fee2e2` | `rgba(220, 38, 38, 0.15)` |
| **Dark** (badge/alert text) | `#b91c1c` | `#fca5a5` |

### Info
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Color** | `#3b82f6` | `#60a5fa` |
| **Light** (badge/alert bg) | `#dbeafe` | `rgba(59, 130, 246, 0.15)` |
| **Dark** (badge/alert text) | `#2563eb` | `#93bbfd` |

---

## 13. Legacy Alerts

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Warning Text** | `#8a6d3b` | `#fcd34d` |
| **Warning Background** | `#fcf8e3` | `rgba(245, 158, 11, 0.12)` |
| **Warning Border** | `#faf2cc` | `rgba(245, 158, 11, 0.25)` |
| **Success Text** | `#3c763d` | `#6ee7b7` |
| **Success Background** | `#dff0d8` | `rgba(16, 185, 129, 0.12)` |
| **Success Border** | `#d0e9c6` | `rgba(16, 185, 129, 0.25)` |
| **Info Text** | `#31708f` | `#93bbfd` |
| **Info Background** | `#d9edf7` | `rgba(59, 130, 246, 0.12)` |
| **Info Border** | `#bcdff1` | `rgba(59, 130, 246, 0.25)` |

---

## 14. Miscellaneous

| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Add Color** | Player add indicator | `green` | `#4ade80` |
| **Drop Color** | Player drop indicator | `red` | `#f87171` |
| **Code Background** | Code/message blocks | `#31382d` | `#151526` |
| **Shadow Color** | Base shadow tint (HSL) | `220deg 3% 15%` | `240deg 10% 4%` |
| **Focus Ring Shadow** | Focus indicator | `rgba(28,73,124,0.25)` | `rgba(59,130,246,0.4)` |
| **Button Hover Shadow** | Button lift effect | `rgba(37,99,235,0.35)` | `rgba(59,130,246,0.3)` |

---

## 15. Navigation Drawer

### Backgrounds
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Nav Background** | `#ffffff` | `#1e1e32` |
| **Nav Background Subtle** | `#f9fafb` | `#18182a` |
| **Footer Background** | `#f9fafb` | `#151526` |

### Text
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Nav Text** | `#333333` | `#d8d8e0` |
| **Nav Text Muted** | `#6b7280` | `#8a8a9a` |
| **Nav Text Subtle** | `#9ca3af` | `#6b6b80` |
| **Section Header** | `#777777` | `#8a8a9a` |
| **Footer Text Muted** | `#6b7280` | `#6b6b80` |

### Borders
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Nav Border** | `#d0d2d6` | `#2e2e44` |
| **Nav Border Subtle** | `#f3f4f6` | `#232338` |
| **Footer Border** | `#e5e7eb` | `#2a2a3d` |

### Interactive States
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Hover Background** | `#f3f4f6` | `#2a2a3d` |
| **Active Background** | `rgba(28,73,124,0.1)` | `rgba(201,169,78,0.15)` |
| **Active Text** | `#1c497c` | `#c9a94e` |
| **Active Border Left** | `#1c497c` | `#c9a94e` |

### Subcomponents
| Token | Used For | Light Mode | Dark Mode |
|-------|----------|-----------|-----------|
| **Badge Background** | Notification count | `#ef4444` | `#ef4444` |
| **Badge Text** | Notification text | `#ffffff` | `#ffffff` |
| **Switcher Background** | League toggle bg | `#f3f4f6` | `#18182a` |
| **Switcher Border** | League toggle border | `#e5e7eb` | `#2e2e44` |
| **Switcher Active Bg** | Selected league | `#1c497c` | `#c9a94e` |
| **Switcher Active Text** | Selected league text | `#ffffff` | `#121220` |
| **Switcher Inactive Text** | Unselected league | `#6b7280` | `#6b6b80` |
| **Tooltip Background** | Hover tooltip | `#1f2937` | `#2a2a3d` |
| **Tooltip Text** | Tooltip text | `#ffffff` | `#e0e0e8` |
| **Verify Prompt Bg** | Team verify area | `rgba(28,73,124,0.05)` | `rgba(201,169,78,0.08)` |
| **Verify Prompt Border** | Team verify border | `#1c497c` | `#c9a94e` |
| **Verify Prompt Text** | Team verify text | `#1c497c` | `#c9a94e` |
| **Overlay** | Backdrop behind drawer | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` |

### Scrollbar
| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| **Track** | `transparent` | `transparent` |
| **Thumb** | `#d1d5db` | `#3a3a50` |
| **Thumb Hover** | `#9ca3af` | `#5a5a70` |

---

## 16. New Tokens (Dark Mode Only)

These are new tokens that create the elevation system for dark mode surfaces.

| Token | Purpose | Suggested Usage | Dark Mode Value |
|-------|---------|-----------------|-----------------|
| **Surface 1** | Lowest elevation | Page background, recessed areas | `#121220` |
| **Surface 2** | Mid elevation | Content panels, cards | `#1e1e32` |
| **Surface 3** | Highest elevation | Dropdowns, modals, tooltips | `#2a2a3d` |
| **Border Default** | Standard border | Card/content borders | `#2e2e44` |
| **Border Subtle** | Faint dividers | Section separators | `#232338` |
| **Text Primary** | Primary text | Body copy, headings | `#e0e0e8` |
| **Text Secondary** | De-emphasized text | Captions, labels | `#8a8a9a` |
| **Text Disabled** | Non-interactive text | Disabled form labels | `#5a5a6a` |
| **Scrollbar Thumb** | Page scrollbar handle | Global scrollbar | `#3a3a50` |
| **Scrollbar Track** | Page scrollbar track | Global scrollbar | `transparent` |

---

## Color Palette Summary

The dark mode theme is built from these core values:

| Role | Hex | Description |
|------|-----|-------------|
| **Deepest background** | `#121220` | Page body, recessed areas |
| **Base surface** | `#1e1e32` | Cards, panels, content areas |
| **Elevated surface** | `#2a2a3d` | Hovers, dropdowns, tooltips |
| **Subtle border** | `#232338` | Dividers, subtle separation |
| **Standard border** | `#2e2e44` | Card borders, input borders |
| **Muted text** | `#6b6b80` | Placeholders, disabled hints |
| **Secondary text** | `#8a8a9a` | Labels, table headers, captions |
| **Primary text** | `#e0e0e8` | Body copy, readable content |
| **Bright text** | `#ededf0` | Headings, emphasis |
| **Gold accent** | `#c9a94e` | Active states, hover accents, CTA highlights |
| **Brand blue** | `#1c497c` | Primary buttons, brand identity |
| **Bright blue** | `#3b82f6` | Links, focus rings, info states |
