# DataBoy Master Brand Guidelines (Option 3 — Connected Intelligence)

This document contains the official usage guidelines, rules, layout requirements, and branding standards for the refined **DataBoy Academic Platform** visual assets.

---

## 1. Brand Concept & Master Logo

The **Connected Intelligence** (Option 3) concept serves as the foundational brand direction for DataBoy. 

It represents the mathematical marriage of human intellect and technology—combining a gender-neutral, classical head silhouette with fluid, clean network/circuit nodes symbolizing structured guidance, academic security, and digital expertise.

### 1.1 Master Design Qualities
* **Simplicity**: Purged of redundant lines, easily readable at micro-scales (16px browser tabs).
* **Balance**: Centered and symmetric node structures.
* **Academic Gravity**: Serialized styling that feels prestigious, avoiding robotic, cartoonish, or AI chatbot tropes.
* **Universal Gender Neutrality**: The head profile silhouette is mathematically balanced to remain inclusive and gender-neutral.

---

## 2. Logo Formats & Visual Placements

The DataBoy brand system includes five optimized logo variations for different display layouts:

```
                  [1. PRIMARY LOGO]
         +----------------------------------+
         |   (📇 Icon)  DataBoy (Wordmark)  |
         +----------------------------------+
                    (Horizontal Grid)

  [2. ICON ONLY]    [3. WORDMARK ONLY]   [4. STACKED LOGO]
  +------------+    +----------------+   +---------------+
  |   (📇)     |    |    DataBoy     |   |     (📇)      |
  +------------+    +----------------+   |    DataBoy    |
  (App / Fav)         (Clean Text)       +---------------+
                                           (Square Grid)
```

### 2.1 Logo Formats Table

| Logo Format | Asset Filename | Placement & Usage Role |
| :--- | :--- | :--- |
| **Primary Logo** | `logo.svg` | Desktop headers, landing page banner folds. |
| **Horizontal Logo** | `logo-horizontal.svg`| Compact web navigations, invoice headings, PDF covers. |
| **Stacked Logo** | `logo-stacked.svg` | Centered landing page folds, app login headers. |
| **Icon Only** | `icon.svg` | Mobile app icons, PWA shortcuts, favicons, social avatars. |
| **Wordmark Only** | `wordmark.svg` | Sub-page footers, legal headers, minimal document cards. |
| **Monochrome (Black)** | `logo-black.svg` | High-quality white paper printouts, legal watermark sheets. |
| **Monochrome (White)** | `logo-white.svg` | Clean overlays on colored backgrounds. |

---

## 3. Brand Rules & Clearances

### 3.1 Exclusions / Spacing Area
To preserve clarity and visual integrity, keep a protective buffer zone of empty vertical and horizontal space around the logo:
* **Minimum Spacing**: Standard spacing is `X` (where `X` is equal to **50% of the icon's height**). No other logos, headings, or visual elements should ever enter this clearance zone:
  ```
  +-------------------------------------+
  |          [ Clearance Zone ]         |
  |    +---------------------------+    |
  |    |  (📇)  DataBoy            |    |
  |    +---------------------------+    |
  |          [ Clearance Zone ]         |
  +-------------------------------------+
  ```

### 3.2 Minimum Dimensions
* **Primary Logo (with Wordmark)**:
  - *Digital (Web/PWA)*: Minimum width **120px** / Minimum height **24px**.
  - *Print (Documents/PDFs)*: Minimum width **38mm**.
* **Icon Only**:
  - *Digital (Favicon/Tabs)*: Minimum size **16px x 16px**.
  - *Print (Badge)*: Minimum size **8mm x 8mm**.

### 3.3 Theme & Background Optimizations
* **Dark Surfaces (Slate `#0F172A`)**: Use the **Dark Version** logo (`logo-dark.svg`). The master head profile icon should render in clear white or light-cyan, projected over an active Indigo-to-Purple gradient glow.
* **Light Surfaces (White / Slate `#F8FAFC`)**: Use the **Light Version** logo (`logo-light.svg`). The master head profile icon and text should render in solid Slate-900, with a clean Indigo-to-Purple accent path.
* **Complex Backgrounds (Media / Imagery)**: Never overlay the logo on busy backgrounds. Use a solid, high-opacity backdrop capsule (`bg-background/80 backdrop-blur-md`) to separate the visual assets.

---

## 4. Platform Asset Optimizations

### 4.1 App Icon (Android, iOS, PWA)
* **Adaptive Padding (Android)**: Ensure the center head silhouette fits inside a safe **66% inner circle bounds** to protect it from adaptive device mask clippings (squircle, rounded circle, teardrop).
* **Grid Background**: Utilize a deep Slate-950 solid background (`#0A0E1A`) for mobile shortcuts to match premium mobile themes.

### 4.2 Browser Favicon
* **Micro-Legibility (16px - 32px)**: In micro-sizes, the internal connection lines are dynamically styled with double line weight (`stroke-width: 4px`) to preserve high-contrast shape definitions on small browser tabs.

### 4.3 Social Media Profiles (Avatars)
* **Centering Constraint**: The master icon is perfectly centered on a circular grid with a soft, rich HSL outer radial glow, guaranteeing high visibility when cropped to a circle by platforms like LinkedIn, X, and WhatsApp.

---

## 5. Correct vs. Incorrect Usage Examples

```
  ✔ CORRECT (Premium SaaS Standard)
  - Dark-Theme Logo used on Slate-900 backdrops.
  - Generous 50% clearance zone maintained.
  - Icon-only logo used for circular mobile app shortcuts.
  - Wordmark matches the brand OutFit typography system.

  ✘ INCORRECT (Avoid at all costs)
  - Never stretch, squash, or mathematically distort logo proportions.
  - Never recolor the logo in random shades (e.g. neon yellow, plain red).
  - Never wrap the head icon in cartoonish shapes or AI chatbot dialogue bubbles.
  - Never place the full text logo inside a micro 16px favicon tab.
```
