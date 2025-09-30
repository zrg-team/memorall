#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Post-build script to prepare production manifest
 * - Removes localhost from CSP
 * - Ensures production-ready settings
 */

const distDir = 'dist/chrome';
const manifestPath = join(distDir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('❌ Error: manifest.json not found in dist/chrome/');
  console.error('   Run "npm run build" first');
  process.exit(1);
}

console.log('📦 Preparing production build...');

try {
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
  console.log('✅ Production manifest updated');
  console.log('');
  console.log('🎉 Production build ready!');
  console.log('📁 Location: dist/chrome/');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Test: Load dist/chrome/ as unpacked extension');
  console.log('  2. Package: npm run package:chrome');
  console.log('  3. Submit to Chrome Web Store');
  console.log('');
} catch (error) {
  console.error('❌ Error preparing production build:', error.message);
  process.exit(1);
}
