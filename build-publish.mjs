#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';

/**
 * Build and package everything for store submission
 * Output: publish/ directory with ready-to-submit packages
 */

const publishDir = 'publish';

console.log('🚀 Building Memorall for store submission...\n');

// Step 1: Clean publish directory
console.log('📁 Cleaning publish directory...');
if (existsSync(publishDir)) {
  rmSync(publishDir, { recursive: true, force: true });
}
mkdirSync(publishDir, { recursive: true });
console.log('✅ Publish directory ready\n');

// Step 2: Build production version
console.log('🔨 Building production extension...');
try {
  execSync('cross-env NODE_ENV=production extension build', { stdio: 'inherit' });
  console.log('✅ Production build complete\n');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

// Step 3: Prepare production manifest
console.log('📝 Preparing production manifest...');
const manifestPath = join('dist', 'chrome', 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('❌ Error: manifest.json not found in dist/chrome/');
  process.exit(1);
}

try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const distDir = join('dist', 'chrome');

  // Remove localhost from CSP
  if (manifest.content_security_policy?.extension_pages) {
    const originalCSP = manifest.content_security_policy.extension_pages;
    manifest.content_security_policy.extension_pages = originalCSP
      .replace(/http:\/\/localhost:\*/g, '')
      .replace(/http:\/\/127\.0\.0\.1:\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Clean up web_accessible_resources - remove non-existent files
  if (manifest.web_accessible_resources) {
    for (const resource of manifest.web_accessible_resources) {
      if (resource.resources) {
        resource.resources = resource.resources.filter(res => {
          // Keep wildcards
          if (res.includes('*')) return true;

          // Check if specific file exists
          const filePath = join(distDir, res);
          const exists = existsSync(filePath);

          if (!exists) {
            console.log(`  ⚠ Removing non-existent: ${res}`);
          }

          return exists;
        });
      }
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('✅ Production manifest updated\n');
} catch (error) {
  console.error('❌ Error preparing manifest:', error.message);
  process.exit(1);
}

// Step 4: Copy Chrome build
console.log('📦 Packaging Chrome extension...');
const chromeDir = join(publishDir, 'chrome');
cpSync(join('dist', 'chrome'), chromeDir, { recursive: true });
console.log('✅ Chrome package ready\n');

// Step 5: Copy for Edge (uses same as Chrome)
console.log('📦 Packaging Edge extension...');
const edgeDir = join(publishDir, 'edge');
cpSync(join('dist', 'chrome'), edgeDir, { recursive: true });
console.log('✅ Edge package ready\n');

// Step 6: Create ZIP files
console.log('🗜️  Creating ZIP archives...');

try {
  // Chrome ZIP
  console.log('  📦 Creating Chrome ZIP...');
  const chromeZip = new AdmZip();
  chromeZip.addLocalFolder(chromeDir);
  chromeZip.writeZip(join(publishDir, 'memorall-chrome.zip'));
  console.log('  ✅ memorall-chrome.zip created');

  // Edge ZIP
  console.log('  📦 Creating Edge ZIP...');
  const edgeZip = new AdmZip();
  edgeZip.addLocalFolder(edgeDir);
  edgeZip.writeZip(join(publishDir, 'memorall-edge.zip'));
  console.log('  ✅ memorall-edge.zip created');
} catch (error) {
  console.error('❌ Error creating ZIP files:', error.message);
  process.exit(1);
}

console.log('\n✅ All packages created successfully!\n');

// Step 7: Create submission info file
console.log('📄 Creating submission info...');
const infoContent = `# Memorall Store Submission Package

Generated: ${new Date().toISOString()}
Version: ${JSON.parse(readFileSync('package.json', 'utf8')).version}

## Contents

### Chrome Web Store
- **Directory**: publish/chrome/
- **ZIP**: publish/memorall-chrome.zip
- **Upload to**: https://chrome.google.com/webstore/devconsole

### Microsoft Edge Add-ons
- **Directory**: publish/edge/
- **ZIP**: publish/memorall-edge.zip
- **Upload to**: https://partner.microsoft.com/dashboard/microsoftedge

## Next Steps

1. **Test the unpacked extensions**:
   - Chrome: Load \`publish/chrome/\` as unpacked extension
   - Edge: Load \`publish/edge/\` as unpacked extension

2. **Submit to stores**:
   - Upload \`memorall-chrome.zip\` to Chrome Web Store
   - Upload \`memorall-edge.zip\` to Microsoft Edge Add-ons

3. **Review checklists**:
   - See SUBMISSION_CHECKLIST.md for complete submission steps
   - See STORE_SUBMISSION.md for detailed store-specific guides

## Required Before Submission

- [ ] Create store icons (128x128, 256x256, 512x512)
- [ ] Take 3-5 screenshots
- [ ] Host privacy policy (PRIVACY_POLICY.md)
- [ ] Test all features work
- [ ] Verify no console errors
- [ ] Check all permissions are justified

## Support

- GitHub: https://github.com/zrg-team/memorall
- Issues: https://github.com/zrg-team/memorall/issues
`;

writeFileSync(join(publishDir, 'README.md'), infoContent);
console.log('✅ Submission info created\n');

// Final summary
console.log('═══════════════════════════════════════════════════════════');
console.log('🎉 Build Complete!');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('📦 Packages created in: publish/');
console.log('');
console.log('  📁 Chrome:  publish/chrome/');
console.log('  📁 Edge:    publish/edge/');
console.log('  🗜️  Chrome:  publish/memorall-chrome.zip');
console.log('  🗜️  Edge:    publish/memorall-edge.zip');
console.log('');
console.log('Next steps:');
console.log('  1. Test: Load publish/chrome/ as unpacked extension');
console.log('  2. Review: Check SUBMISSION_CHECKLIST.md');
console.log('  3. Submit: Upload ZIP files to stores');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
