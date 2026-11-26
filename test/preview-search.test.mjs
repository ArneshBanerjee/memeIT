import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/preview-search.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { searchPreview } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const metadata = JSON.parse(readFileSync(new URL('../assets/internet-metadata.json', import.meta.url), 'utf8'));
const supplements = JSON.parse(readFileSync(new URL('../assets/public-supplemental.json', import.meta.url), 'utf8'));
const catalog = metadata.map(item => ({ ...item, id: `${item.source}:${item.id}`, title: '' }));
for (const item of supplements) {
  const index = catalog.findIndex(candidate => candidate.id === item.id);
  if (index >= 0) catalog[index] = item;
  else catalog.push(item);
}
const cookedDog = 'imgflip:574931918';
test('descriptions, slang, word forms and swapped letters find the actual Cooked Dog', () => {
  for (const query of ['dog cooked', 'god eye closed', 'brown dog closing his eyes in the sunset', 'labrador shutting eyes accepting fate', 'dog is doomed']) {
    assert.equal(searchPreview(catalog, query)[0]?.id, cookedDog, query);
  }
});
test('different visual scenes do not collapse to the same animal reaction', () => {
  for (const query of ['dog in room on fire', 'pretending everything is fine while the room burns']) {
    const first = searchPreview(catalog, query)[0];
    assert.match(first?.description || '', /flames|burning|fire/i, query);
    assert.notEqual(first?.id, cookedDog);
  }
  const first = searchPreview(catalog, 'sweating man choosing two red buttons')[0];
  assert.match(first?.description || '', /buttons/i);
});
test('word boundaries and conservative spelling avoid substring-only matches', () => {
  const examples = [
    {id:'car',title:'car',description:'A red car on the road',tags:[]},
    {id:'cat',title:'cat',description:'A white cat in the kitchen',tags:[]},
  ];
  assert.equal(searchPreview(examples, 'cat')[0].id, 'cat');
  assert.equal(searchPreview(examples, 'car')[0].id, 'car');
  assert.deepEqual(searchPreview(examples, 'ar'), []);
});
test('empty browsing retains source order', () => {
  assert.deepEqual(searchPreview(catalog, ''), catalog);
});
