#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Post-build script to prepare production manifest
 * - Removes localhost from CSP
 * - Ensures production-ready settings
 */

const distDirs = ['publish/extension/chrome', 'publish/extension/edge'].filter((distDir) =>
  existsSync(join(distDir, 'manifest.json')),
);

if (distDirs.length === 0) {
  console.error('❌ Error: manifest.json not found in publish/extension/chrome/ or publish/extension/edge/');
  console.error('   Run "yarn build:extension:all" first');
  process.exit(1);
}

console.log('📦 Preparing production build...');

for (const distDir of distDirs) {
  const manifestPath = join(distDir, 'manifest.json');

  try {
    console.log(`📝 Updating ${manifestPath}...`);

    // Read manifest
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    // Update CSP to remove localhost
    if (manifest.content_security_policy?.extension_pages) {
      const originalCSP = manifest.content_security_policy.extension_pages;

      // Remove localhost references
      manifest.content_security_policy.extension_pages = originalCSP
        .replace(/http:\/\/localhost:\*/g, '')
        .replace(/http:\/\/127\.0\.0\.1:\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      console.log('✅ Removed localhost from CSP');
    }

    // Write updated manifest
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Production manifest updated: ${distDir}`);
  } catch (error) {
    console.error(`❌ Error preparing ${distDir}:`, error.message);
    process.exit(1);
  }
}

console.log('');
console.log('🎉 Production builds ready!');
console.log(`📁 Locations: ${distDirs.join(', ')}`);
console.log('');
console.log('Next steps:');
for (const distDir of distDirs) {
  console.log(`  - Test: Load ${distDir}/ as unpacked extension`);
}
console.log('  - Package: yarn package:extension:all');
console.log('  - Submit to Chrome Web Store and Microsoft Edge Add-ons');
console.log('');
