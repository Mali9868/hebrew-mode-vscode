// Packaging step: writes build/README.md and build/CHANGELOG.md for the VSIX. Same content as the
// files in the repository, with Hebrew lines wrapped in right-to-left isolates so they read correctly
// on VS Code's extension page (see src/tools/storeDocs.ts). Run after `tsc`.
const fs = require('fs');
const path = require('path');
const { isolateHebrewMarkdown } = require('../out/tools/storeDocs');

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
for (const name of ['README.md', 'CHANGELOG.md']) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  fs.writeFileSync(path.join(root, 'build', name), isolateHebrewMarkdown(source));
}
