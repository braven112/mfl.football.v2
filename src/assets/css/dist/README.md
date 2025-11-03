# CDN CSS Themes - Usage Documentation

This directory contains standalone CSS theme files that can be hosted on a CDN and referenced directly by external consumers without requiring a build process.

## Available Themes

### `playoff-blue-green.css`
The original playoff blue-green theme with modern optimizations and embedded design tokens.

### `dark-theme.css`
Dark theme variant with appropriate contrast ratios and color adjustments for low-light environments.

### `light-theme.css`
Clean light theme with neutral colors suitable for most applications.

### `blue-theme.css`
Blue-focused theme with blue color palette variations.

### `green-theme.css`
Nature-inspired green theme with earth-tone color variations.

### `red-theme.css`
Bold red theme with warm color palette suitable for sports or high-energy applications.

## CDN Usage

Reference any theme file directly from your CDN:

```html
<!-- Include one theme file in your HTML head -->
<link rel="stylesheet" href="https://your-cdn.com/path/to/playoff-blue-green.css">
```

## HTML Integration

Each CSS file is completely standalone and includes:
- Design tokens (CSS custom properties)
- Base styles and typography
- Component styles
- Utility classes
- Theme-specific colors and styling

### Basic HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fantasy Football App</title>
    <!-- Include your chosen theme -->
    <link rel="stylesheet" href="https://your-cdn.com/path/to/playoff-blue-green.css">
</head>
<body>
    <!-- Your content here -->
    <div class="report-wrapper">
        <h2>Team Rankings</h2>
        <table class="report">
            <thead>
                <tr>
                    <th>Team</th>
                    <th>Points</th>
                    <th>Record</th>
                </tr>
            </thead>
            <tbody>
                <tr class="oddtablerow">
                    <td>Team Alpha</td>
                    <td>1,245</td>
                    <td>8-2</td>
                </tr>
                <tr class="eventablerow">
                    <td>Team Beta</td>
                    <td>1,180</td>
                    <td>7-3</td>
                </tr>
            </tbody>
        </table>
    </div>
</body>
</html>
```

## Available Components

### Cards and Wrappers
- `.report-wrapper` - Main container for reports and content
- `.card` - General purpose card component

### Tables
- `.report` - Main table styling for fantasy football data
- `.oddtablerow` - Alternating row styling
- `.eventablerow` - Event/highlighted row styling

### Buttons and Forms
- `.btn` - Primary button styling
- `input[type="text"]`, `input[type="password"]`, `textarea`, `select` - Form input styling

### Alerts
- `.alert` - Base alert component
- `.alert-info` - Information alerts
- `.alert-warning` - Warning alerts
- `.alert-success` - Success alerts
- `.alert-error` - Error alerts

### Utility Classes
- `.hidden` - Hide elements
- `.text-center`, `.text-left`, `.text-right` - Text alignment
- `.text-uppercase` - Text transformation
- `.text-primary`, `.text-secondary`, `.text-muted` - Text colors

## Customization

Each theme uses CSS custom properties (variables) that can be overridden:

```css
/* Override theme colors */
:root {
    --color-primary: #your-color;
    --bg-primary: #your-background;
    --text-primary: #your-text-color;
}
```

## Theme Switching

To switch themes dynamically, replace the CSS file reference:

```javascript
// Switch to dark theme
const themeLink = document.querySelector('link[rel="stylesheet"]');
themeLink.href = 'https://your-cdn.com/path/to/dark-theme.css';
```

## Font Requirements

All themes expect the following fonts to be available:
- `BentonSans400` - Primary font family
- `playoff-bold` - Secondary font family for headings

Include these fonts via CSS imports or web fonts before the theme CSS.

## Browser Support

These CSS files use modern CSS features:
- CSS Custom Properties (CSS Variables)
- CSS Grid and Flexbox
- Modern pseudo-selectors
- Logical properties

Supports all modern browsers (Chrome 88+, Firefox 85+, Safari 14+, Edge 88+).

## File Sizes

All theme files are optimized for CDN delivery:
- Minified and optimized CSS
- Embedded design tokens (no external dependencies)
- Typical file size: 15-25KB per theme

## Performance Tips

1. **Preload critical CSS**: Use `<link rel="preload" as="style">` for faster loading
2. **HTTP/2**: Serve from HTTP/2 enabled CDN for optimal performance
3. **Compression**: Enable gzip/brotli compression on your CDN
4. **Caching**: Set appropriate cache headers for long-term caching