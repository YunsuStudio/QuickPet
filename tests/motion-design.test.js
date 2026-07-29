const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('main interface uses one restrained motion system with reduced-motion support', () => {
  const theme = read('src/renderer/index-theme.css');
  const app = read('src/renderer/app.js');

  assert.match(theme, /--motion-fast:\s*120ms/);
  assert.match(theme, /--motion-base:\s*180ms/);
  assert.match(theme, /--motion-slow:\s*260ms/);
  assert.match(theme, /\.view-section\.view-enter/);
  assert.match(theme, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(app, /classList\.add\('view-enter'\)/);
  assert.doesNotMatch(theme, /\.primary-button:hover\s*\{[^}]*transform:\s*none/s);
  assert.doesNotMatch(theme, /\.model-card:hover\s*\{[^}]*transform:\s*none/s);
});

test('pet motion is eased and 3D following is frame-rate independent', () => {
  const pet = read('src/renderer/pet.css');
  const pet3d = read('src/renderer/pet-3d-entry.js');

  assert.match(pet, /--pet-ease-out:\s*cubic-bezier/);
  assert.match(pet, /walkBob\s+\.62s/);
  assert.match(pet3d, /crossFadeTo\(action,\s*0\.38/);
  assert.match(pet3d, /1\s*-\s*Math\.exp\(-delta\s*\*\s*5\.5\)/);
});

test('3D renderer releases imported textures when switching models', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'pet-3d-entry.js'), 'utf8');
  assert.match(source, /value\?\.isTexture/);
  assert.match(source, /mixer\?\.uncacheRoot/);
});
