const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const frontDir = path.resolve(__dirname, '..', '..', 'coach-financier-front');
const distDir = path.join(frontDir, 'dist');
const publicDir = path.resolve(__dirname, '..', 'public');

function run(cmd, opts = {}) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

try {
  // Install and build front
  run('npm ci', { cwd: frontDir });
  run('npm run build', { cwd: frontDir });

  // Copy dist to backend/public (remove existing)
  if (fs.existsSync(publicDir)) {
    fs.rmSync(publicDir, { recursive: true, force: true });
  }
  fs.mkdirSync(publicDir, { recursive: true });

  // Node 16+ supports fs.cp; use it for recursive copy
  if (fs.cp) {
    fs.cpSync(distDir, publicDir, { recursive: true });
  } else {
    // fallback: copy files recursively
    const copyRecursive = (src, dest) => {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyRecursive(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
      }
    };
    copyRecursive(distDir, publicDir);
  }

  console.log('Front built and copied to backend/public');
  process.exit(0);
} catch (err) {
  console.error('Error building/copying front:', err);
  process.exit(1);
}
