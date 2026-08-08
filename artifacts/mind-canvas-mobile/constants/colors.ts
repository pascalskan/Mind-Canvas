/**
 * Design tokens — synced with the Mind Canvas web app palette.
 * Background from index.css, bubble palette from PILLAR_COLORS.
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#111827',
    tint: '#6B52D0',

    // Core surfaces (matches web: #F5F5F7)
    background:   '#F5F5F7',
    foreground:   '#111827',

    // Cards / panels
    card:         '#FFFFFF',
    cardForeground: '#111827',

    // Primary — first PILLAR_COLOR (hsl 250 60 58)
    primary:         '#6B52D0',
    primaryForeground: '#FFFFFF',

    // Secondary
    secondary:         '#F0F0F5',
    secondaryForeground: '#374151',

    // Muted
    muted:         '#F0F0F5',
    mutedForeground: '#9CA3AF',

    // Accent
    accent:         '#F0F0F5',
    accentForeground: '#374151',

    // Destructive
    destructive:         '#EF4444',
    destructiveForeground: '#FFFFFF',

    // Borders
    border: '#E5E7EB',
    input:  '#E5E7EB',
  },

  // Rounded corners — matches the glass-bubble aesthetic
  radius: 16,
};

export default colors;
