/**
 * DataBoy Brand Pack - Automated PNG & WebP Asset Builder
 * 
 * This script automates the generation of multi-resolution raster assets from the master SVGs.
 * Required: npm install sharp
 * Run: node public/brand-pack/generate-pngs.js
 */

const fs = require('fs');
const path = require('path');

// Target directory paths
const BRAND_PACK_DIR = __dirname;
const SVG_ICON_PATH = path.join(BRAND_PACK_DIR, 'Icon-Only', 'icon.svg');
const SVG_FAVICON_PATH = path.join(BRAND_PACK_DIR, 'Favicons', 'favicon-tab.svg');
const SVG_AVATAR_PATH = path.join(BRAND_PACK_DIR, 'Social-Avatars', 'avatar-linkedin.svg');

// Required sizes for iOS, Android, PWA, and Web shortcuts
const SIZES = [16, 32, 48, 72, 96, 128, 144, 180, 192, 256, 384, 512];

async function generate() {
  console.log('⚡ Starting DataBoy Brand Asset Compilation...');
  
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.error('\n❌ ERROR: "sharp" library is required to run this generator.');
    console.log('👉 Please run the following command in your terminal first:');
    console.log('   npm install sharp\n');
    process.exit(1);
  }

  // Define out directories
  const appIconOut = path.join(BRAND_PACK_DIR, 'App-Icons');
  const faviconOut = path.join(BRAND_PACK_DIR, 'Favicons');
  const avatarOut = path.join(BRAND_PACK_DIR, 'Social-Avatars');

  // Helper function to build resize outputs
  const buildRaster = async (src, destDir, prefix) => {
    for (const size of SIZES) {
      const pngPath = path.join(destDir, `${prefix}-${size}x${size}.png`);
      const webpPath = path.join(destDir, `${prefix}-${size}x${size}.webp`);
      
      // Generate PNG
      await sharp(src)
        .resize(size, size)
        .png()
        .toFile(pngPath);
        
      // Generate WebP
      await sharp(src)
        .resize(size, size)
        .webp({ quality: 90 })
        .toFile(webpPath);
        
      console.log(`✓ Compiled: ${prefix}-${size}x${size} (PNG & WebP)`);
    }
  };

  try {
    console.log('\n📱 Compiling PWA & Mobile App Icons...');
    await buildRaster(SVG_ICON_PATH, appIconOut, 'app-icon');

    console.log('\n🌐 Compiling Micro-scale Favicons...');
    await buildRaster(SVG_FAVICON_PATH, faviconOut, 'favicon');

    console.log('\n👥 Compiling High-res Social Avatars...');
    await buildRaster(SVG_AVATAR_PATH, avatarOut, 'social-avatar');

    console.log('\n🎉 Brand Pack compilation completed successfully!');
  } catch (error) {
    console.error('\n❌ Compilation failed due to an error:', error.message);
  }
}

generate();
