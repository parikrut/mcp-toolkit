# Nordic Styles

> Pattern documentation for the Nordic minimal design system, theme tokens, and animation utilities.

## 1. Component Pattern

The **Nordic Styles** system is a CSS-first design token layer built on
Tailwind CSS v4's `@theme` directive. It defines colour palettes, semantic
tokens, keyframe animations, and scroll-reveal utility classes in a single
shared CSS file consumed by all applications and the `@civic/ui` component
library.

## 2. Overview

The design system follows a "Nordic minimal" aesthetic: muted natural colours,
generous whitespace, subtle animations, and a restrained palette. It provides:

| Layer             | What it defines                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| **Colour tokens** | Background, surface, border, semantic (success/warning/error/info), text hierarchy, sidebar         |
| **Brand palette** | `nordic-blue`, `nordic-green`, `nordic-amber`, `nordic-rose`                                        |
| **Dark mode**     | Full `.dark` class override for every token                                                         |
| **Animations**    | `fadeInUp`, `fadeIn`, `scaleIn`, `slideInLeft/Right`, `fadeSlideIn`, `dividerGrow`                  |
| **Scroll reveal** | `.reveal`, `.reveal-fade`, `.reveal-scale`, `.reveal-left`, `.reveal-right` + `.is-visible` trigger |
| **Stagger**       | `.stagger-children.is-visible > *` with 80 ms incremental delays (up to 8 children)                 |
| **Motion safety** | `prefers-reduced-motion` media query disables all animations                                        |

Applications consume the theme via a single CSS import:

```css
@import "@civic/ui/theme.css";
```

## 3. Rules

1. **Never use raw hex colours in component code.** Always reference semantic
   tokens: `text-(--color-text-primary)`, `bg-(--color-surface)`, etc.
2. **Dark mode is automatic.** Add the `.dark` class to the `<html>` element;
   all tokens swap. Components must not set their own dark overrides.
3. **Use `ScrollReveal` from `@civic/ui` for entrance animations** — not raw
   CSS classes. The component wires up `IntersectionObserver` and adds the
   `.is-visible` class automatically.
4. **Respect reduced motion.** The theme's `@media (prefers-reduced-motion)`
   rule removes all animations globally. Never add `!important` overrides to
   animation properties.
5. **Grid gaps and spacing** follow Tailwind defaults: `gap-3`, `gap-4`,
   `space-y-6`. Do not override with custom pixel values.
6. **Font stack** uses the `--font-sans` variable mapped to Inter.
7. **Text hierarchy:** `text-primary` for headings and body, `text-secondary`
   for labels and meta, `text-muted` for placeholders and helpers.

## 4. Structure

```
packages/ui/src/styles/theme.css
├── @import "tailwindcss"
├── @theme { … }                      ← colour / animation tokens
├── .dark { … }                       ← dark-mode token overrides
├── @keyframes fadeInUp …             ← 7 keyframe definitions
├── .reveal / .reveal-fade / …        ← scroll-reveal initial states
├── .reveal.is-visible …              ← scroll-reveal active states
├── .stagger-children.is-visible > *  ← stagger delay utility
└── @media (prefers-reduced-motion)   ← motion safety reset
```

**Colour Token Reference:**

| Token                    | Light     | Dark      | Usage                     |
| ------------------------ | --------- | --------- | ------------------------- |
| `--color-background`     | `#ffffff` | `#0f0f0f` | Page background           |
| `--color-surface`        | `#fafafa` | `#171717` | Card / panel background   |
| `--color-surface-alt`    | `#f5f5f5` | `#1c1c1c` | Alternate surface         |
| `--color-border`         | `#e5e5e5` | `#262626` | Default borders           |
| `--color-nordic-blue`    | `#5b7c99` | `#7da3c0` | Primary accent            |
| `--color-nordic-green`   | `#6b8e7b` | `#8db9a0` | Success / positive        |
| `--color-nordic-amber`   | `#c4a35a` | `#d4b96a` | Warning                   |
| `--color-nordic-rose`    | `#b5838d` | `#c9a0a8` | Error / danger            |
| `--color-text-primary`   | `#111111` | `#f0f0f0` | Headings, body text       |
| `--color-text-secondary` | `#525252` | `#a3a3a3` | Labels, meta text         |
| `--color-text-muted`     | `#737373` | `#737373` | Placeholders, helper text |

## 5. Example Implementation

```css
/* packages/ui/src/styles/theme.css */
@import "tailwindcss";

@theme {
    --font-sans: var(--font-inter);

    --color-background: #ffffff;
    --color-foreground: #111111;
    --color-surface: #fafafa;
    --color-surface-alt: #f5f5f5;
    --color-border: #e5e5e5;
    --color-border-strong: #d4d4d4;

    --color-nordic-blue: #5b7c99;
    --color-nordic-green: #6b8e7b;
    --color-nordic-amber: #c4a35a;
    --color-nordic-rose: #b5838d;

    --color-text-primary: #111111;
    --color-text-secondary: #525252;
    --color-text-muted: #737373;
    --color-text-inverse: #ffffff;

    --color-success: #6b8e7b;
    --color-warning: #c4a35a;
    --color-error: #b5838d;
    --color-info: #5b7c99;

    --animate-fade-in-up: fadeInUp 0.6s ease-out both;
    --animate-fade-in: fadeIn 0.5s ease-out both;
    --animate-scale-in: scaleIn 0.5s ease-out both;
    --animate-slide-in-left: slideInLeft 0.6s ease-out both;
    --animate-slide-in-right: slideInRight 0.6s ease-out both;
}

.dark {
    --color-background: #0f0f0f;
    --color-foreground: #f5f5f5;
    --color-surface: #171717;
    --color-surface-alt: #1c1c1c;
    --color-border: #262626;
    --color-nordic-blue: #7da3c0;
    --color-nordic-green: #8db9a0;
    --color-nordic-amber: #d4b96a;
    --color-nordic-rose: #c9a0a8;
    --color-text-primary: #f0f0f0;
    --color-text-secondary: #a3a3a3;
}

/* ── Scroll-reveal ── */
.reveal {
    opacity: 0;
    transform: translateY(24px);
}
.reveal-fade {
    opacity: 0;
    transform: none;
}

.reveal.is-visible {
    animation: fadeInUp 0.6s ease-out both;
}
.reveal-fade.is-visible {
    animation: fadeIn 0.5s ease-out both;
}

/* ── Stagger children (80ms per child, max 8) ── */
.stagger-children.is-visible > * {
    animation: fadeSlideIn 0.5s ease-out both;
}
.stagger-children.is-visible > *:nth-child(1) {
    animation-delay: 0ms;
}
.stagger-children.is-visible > *:nth-child(2) {
    animation-delay: 80ms;
}
.stagger-children.is-visible > *:nth-child(3) {
    animation-delay: 160ms;
}
.stagger-children.is-visible > *:nth-child(4) {
    animation-delay: 240ms;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
    .reveal,
    .reveal-fade {
        opacity: 1;
        transform: none;
        animation: none !important;
    }
}
```

**Consuming the theme in an application:**

```css
/* apps/<app>/src/index.css */
@import "@civic/ui/theme.css";
@source "../../packages/ui/src";

@layer base {
    button:not(:disabled),
    a,
    [role="button"]:not(:disabled) {
        cursor: pointer;
    }
}
```
