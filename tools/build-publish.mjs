#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, renameSync } from 'fs';
import { join, basename, dirname } from 'path';
import AdmZip from 'adm-zip';

/**
 * Build and package everything for store submission
 * Output: publish/ directory with ready-to-submit packages
 */

const publishDir = join('publish', 'extension');

function escapeNonAsciiJavaScript(source) {
  let escaped = '';
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code <= 0x7f) {
      escaped += source[i];
      continue;
    }

    escaped += `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return escaped;
}

function sanitizeJavaScriptEncoding(rootDir) {
  let sanitizedCount = 0;

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const filePath = join(dir, entry);
      const stat = statSync(filePath);

      if (stat.isDirectory()) {
        walk(filePath);
        continue;
      }

      if (!/\.(m?js)$/.test(entry)) continue;

      const source = readFileSync(filePath, 'utf8');
      const escaped = escapeNonAsciiJavaScript(source);

      if (escaped !== source) {
        writeFileSync(filePath, escaped, 'utf8');
        sanitizedCount++;
      }
    }
  }

  walk(rootDir);
  return sanitizedCount;
}

function prepareProductionDist(distDir) {
  const manifestPath = join(distDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    console.error(`❌ Error: manifest.json not found in ${distDir}/`);
    process.exit(1);
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

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
              console.log(`  ⚠ Removing non-existent from ${distDir}: ${res}`);
            }

            return exists;
          });
        }
      }
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Production manifest updated: ${distDir}`);
  } catch (error) {
    console.error(`❌ Error preparing ${distDir}:`, error.message);
    process.exit(1);
  }

  console.log(`🔤 Sanitizing JavaScript encoding in ${distDir}...`);
  const sanitizedCount = sanitizeJavaScriptEncoding(distDir);
  console.log(`✅ JavaScript encoding sanitized (${sanitizedCount} file${sanitizedCount === 1 ? '' : 's'} updated)\n`);

  // Fix content_scripts filenames to match manifest references.
  // Some Extension.js versions write hashed manifest refs while outputting unhashed files.
  console.log(`🔧 Fixing content_scripts filenames in ${distDir}...`);
  const fixedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (fixedManifest.content_scripts) {
    for (const entry of fixedManifest.content_scripts) {
      if (!entry.js) continue;
      for (const ref of entry.js) {
        const refPath = join(distDir, ref);
        if (!existsSync(refPath)) {
          // Find the unhashed version: content-0.HASH.js -> content-0.js
          const refBase = basename(ref);
          const refDir = dirname(ref);
          const unhashed = refBase.replace(/\.[a-f0-9]{8}(?=\.js$)/, '');
          const unhashedPath = join(distDir, refDir, unhashed);
          if (existsSync(unhashedPath)) {
            renameSync(unhashedPath, refPath);
            console.log(`  ✅ Renamed ${unhashed} → ${refBase}`);
          } else {
            console.warn(`  ⚠ Missing content script: ${ref} (no unhashed fallback found)`);
          }
        }
      }
    }
  }
  console.log(`✅ Content scripts ready: ${distDir}\n`);
}

const noZip = process.argv.includes('--nozip');

console.log('🚀 Building Memorall for store submission...\n');

// Step 1: Clean only extension artifacts. Web and desktop builds are independent.
console.log('📁 Cleaning extension publish directory...');
if (existsSync(publishDir)) {
  rmSync(publishDir, { recursive: true, force: true });
}
mkdirSync(publishDir, { recursive: true });
console.log('✅ Extension publish directory ready\n');

// Step 2: Build production version
console.log('🔨 Building production extension...');
try {
  execSync('yarn build:extension:all', { stdio: 'inherit' });
  console.log('✅ Production build complete\n');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

// Step 3: Prepare production manifests
console.log('📝 Preparing production manifests...');
const chromeDistDir = join(publishDir, 'chrome');
const edgeDistDir = join(publishDir, 'edge');
prepareProductionDist(chromeDistDir);
prepareProductionDist(edgeDistDir);

console.log('🔒 Auditing packaged code for Manifest V3 compliance...');
try {
  execSync(`node tools/check-mv3-remote-code.mjs ${chromeDistDir} ${edgeDistDir}`, {
    stdio: 'inherit',
  });
  console.log('✅ Manifest V3 remote-code audit complete\n');
} catch (error) {
  console.error('❌ Manifest V3 remote-code audit failed:', error.message);
  process.exit(1);
}

// Step 4: Confirm Chrome build
console.log('📦 Packaging Chrome extension...');
const chromeDir = chromeDistDir;
console.log('✅ Chrome package ready\n');

// Step 5: Confirm Edge build
console.log('📦 Packaging Edge extension...');
const edgeDir = edgeDistDir;
console.log('✅ Edge package ready\n');

// Step 6: Create ZIP files
if (noZip) {
  console.log('⏭️  Skipping ZIP creation (--nozip)\n');
} else {
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
}

// Step 7: Create submission info file
console.log('📄 Creating submission info...');
const infoContent = `# Memorall Store Submission Package

Generated: ${new Date().toISOString()}
Version: ${JSON.parse(readFileSync('package.json', 'utf8')).version}

## Contents

### Chrome Web Store
- **Directory**: publish/extension/chrome/
- **ZIP**: publish/extension/memorall-chrome.zip
- **Upload to**: https://chrome.google.com/webstore/devconsole

### Microsoft Edge Add-ons
- **Directory**: publish/extension/edge/
- **ZIP**: publish/extension/memorall-edge.zip
- **Upload to**: https://partner.microsoft.com/dashboard/microsoftedge

## Next Steps

1. **Test the unpacked extensions**:
   - Chrome: Load \`publish/extension/chrome/\` as unpacked extension
   - Edge: Load \`publish/extension/edge/\` as unpacked extension

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
console.log('📦 Packages created in: publish/extension/');
console.log('');
console.log('  📁 Chrome:  publish/extension/chrome/');
console.log('  📁 Edge:    publish/extension/edge/');
if (!noZip) {
  console.log('  🗜️  Chrome:  publish/extension/memorall-chrome.zip');
  console.log('  🗜️  Edge:    publish/extension/memorall-edge.zip');
}
console.log('');
console.log('Next steps:');
console.log('  1. Test: Load publish/extension/chrome/ as unpacked extension');
console.log('  2. Review: Check SUBMISSION_CHECKLIST.md');
console.log('  3. Submit: Upload ZIP files to stores');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
