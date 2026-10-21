// Guards against a whole class of bug: a function/variable used in src/ but never imported or defined.
// (A missing `weekdayOf` import once silently broke the all-day adhkar scheduler; no test touched that code path.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

test('src/ has no undefined identifiers (no-undef)', async () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const results = await eslint.lintFiles(['src/**/*.js']);
  const problems = results.flatMap(r =>
    r.messages.filter(m => m.ruleId === 'no-undef').map(m => `${r.filePath}:${m.line} ${m.message}`));
  assert.deepEqual(problems, []);
});

test('adhkarService imports weekdayOf (used by the all-day adhkar scheduler)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/services/adhkarService.js', import.meta.url), 'utf8');
  assert.match(src, /import\s*\{[^}]*\bweekdayOf\b[^}]*\}\s*from\s*'\.\.\/utils\/adhkarSchedule\.js'/);
});
