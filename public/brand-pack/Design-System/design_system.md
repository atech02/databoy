# DataBoy Mini Design System (Option 3 — Connected Intelligence)

This document outlines the visual layout scale, design tokens, color systems, and component styles built for the refined **DataBoy Academic Platform** based on the **Connected Intelligence** (Option 3) master brand identity.

---

## 1. Brand Color Tokens

The brand palette is curated specifically to convey **trust, academic prestige, intelligence, and modern technology**. It balances rich, deep indigo and violet shades with premium slate-grays and functional highlight colors.

### 1.1 Core Colors

| Palette Role | Visual Preview | HEX Code | RGB Value | HSL Value |
| :--- | :--- | :--- | :--- | :--- |
| **Primary (Brand Core)** | Indigo-600 | `#4F46E5` | `79, 70, 229` | `243°, 75%, 59%` |
| **Secondary (Accent Glow)** | Purple-500 | `#8B5CF6` | `139, 92, 246` | `258°, 90%, 66%` |
| **Highlight Accent** | Pink-500 | `#EC4899` | `236, 72, 153` | `330°, 81%, 60%` |
| **Dark Surface** | Slate-900 | `#0F172A` | `15, 23, 42` | `222°, 47%, 11%` |
| **Dark Surface (Deep)** | Slate-950 | `#0A0E1A` | `10, 14, 26` | `225°, 44%, 7%` |
| **Light Surface** | Slate-50 | `#F8FAFC` | `248, 250, 252` | `210°, 40%, 98%` |
| **Light Surface (Soft)** | Slate-100 | `#F1F5F9` | `241, 245, 249` | `210°, 40%, 96%` |

### 1.2 Functional & Status Colors

| State / Meaning | Visual Role | HEX Code | RGB Value | HSL Value |
| :--- | :--- | :--- | :--- | :--- |
| **Success (Escrow Clear)** | Emerald-500 | `#10B981` | `16, 185, 129` | `160°, 84%, 39%` |
| **Warning (Action Needed)** | Amber-500 | `#F59E0B` | `245, 158, 11` | `38°, 92%, 50%` |
| **Error (Plagiarism alert)** | Rose-500 | `#EF4444` | `239, 68, 68` | `0°, 84%, 60%` |
| **Muted Text** | Slate-500 | `#64748B` | `100, 116, 139` | `215°, 16°, 47%` |
| **Border / Divider** | Slate-200 / 800 | `#E2E8F0` / `#1E293B` | `226, 232, 240` | `210°, 32%, 91%` |

---

## 2. Typography System

The typography scale is designed to feel highly legible, academically serious, and clean on mobile viewports while reflecting modern SaaS standards.

* **Primary Heading Font**: `Outfit` (Google Font)
  - *Attributes*: Clean, geometric sans-serif with a premium tech feel.
* **Secondary Body Font**: `Inter` (Google Font)
  - *Attributes*: Exceptionally readable at dense sizes, robust layout flow.
* **UI / Monospace Font**: `SF Mono`, `Fira Code` (System Fallback)
  - *Attributes*: Excellent for order IDs, pricing codes, and verification tags.
* **Default Fallbacks**: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `sans-serif`.

### 2.1 Font Scale & Hierarchy

| Typography Role | Font Family | Size (px) | Weight | Line Height | Usage Context |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display Heading** | Outfit | `36px - 60px` | Black (900) | `1.1` | Homepage Hero Titles |
| **Section Title** | Outfit | `24px - 36px` | ExtraBold (800) | `1.2` | Core feature headers |
| **Card Heading** | Outfit | `16px - 20px` | Bold (700) | `1.3` | Grid items & opportunity cards |
| **Body text** | Inter | `14px - 16px` | Medium (500) | `1.5` | Supporting text, paragraphs |
| **CTA Labels** | Inter | `11px - 13px` | Bold (700) | `1` | Buttons, navigation, uppercase |
| **Badge Labels** | Inter | `8px - 10px` | Black (900) | `1` | Powered-by tags, status caps |

---

## 3. UI Element Tokens

These design tokens serve as the building blocks for creating consistent, structured interfaces across the web platform, PWA, and desktop surfaces.

### 3.1 Button Styles
* **Primary Button**: Solid indigo-to-purple linear gradient (`bg-gradient-to-r from-indigo-600 to-purple-600`), white text, bold uppercase tracking-wider text, clean drop shadow (`shadow-md shadow-primary/20`).
* **Secondary/Outline Button**: Transparent background, slate border (`border border-border/40`), slate-gray text, hover color inversion transitions (`transition-colors hover:bg-muted/10`).
* **Micro Badge**: High-density pill capsules, uppercase tracking-widest text (`text-[8px] sm:text-[9px] font-black`), padded with `py-1 px-3.5` and rounded-full corners.

### 3.2 Cards & Surface Containers
* **Border Radius Scale**:
  - `rounded-lg` (8px): Badges, theme toggles, close buttons.
  - `rounded-xl` (12px): Standard cards, sequential step boxes, grids.
  - `rounded-2xl` (16px): Large CTA banners, modal drawer, popups.
* **Shadow Weights**:
  - `shadow-sm`: Flat outline border cards (`border border-border/40`).
  - `shadow-md`: Feature blocks, navigation floating action bar.
  - `shadow-2xl`: Full-screen navigation drawer overlay (`shadow-black/30`).
* **Inputs & Form Controls**:
  - Fully solid background (`bg-muted/20`), slim borders (`border-border/30`), active focus state rings in primary indigo (`focus:ring-2 focus:ring-primary/40`).

---

## 4. Layout & Spacing Scale

DataBoy maintains a tight, clean vertical flow. Standard spacing variables are configured as multiples of `4px` (`base-4`) to ensure rhythm and pixel-perfect grids:

```
space-1  = 4px    (Tiny padding offsets)
space-2  = 8px    (Internal card element gaps)
space-3  = 12px   (Header alignments, logo gaps)
space-4  = 16px   (Standard mobile padding bounds)
space-6  = 24px   (Section gap offsets on mobile)
space-10 = 40px   (Homepage standard section paddings on desktop)
space-12 = 48px   (Large desktop hero separators)
```
