import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compileNewsletter } from '../server/newsletter.js';

const source = JSON.parse(await readFile(new URL('../templates/ijnet-newsletter.source.json', import.meta.url), 'utf8'));
const output = new URL('../output/newsletter-template/', import.meta.url);
await mkdir(output, { recursive: true });
let issue;
if (process.argv[2]) issue = JSON.parse(await readFile(process.argv[2], 'utf8'));
else {
  // Explicitly illustrative content: replace example URLs and copy before sending.
  const keys = [...JSON.stringify(source).matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]);
  const values = Object.fromEntries(keys.map(key => [key, key.endsWith('URL') ? `https://example.com/${key.toLowerCase()}` : `[Replace ${key.toLowerCase().replaceAll('_', ' ')}]`]));
  delete values.EDITOR_NAME; delete values.SIGNOFF;
  Object.assign(values, { YEAR: '2026', SUBHEADER_INSIGHTS: 'RESEARCH', ITEM_TAG: 'DESIGN', ITEM_SOURCE_PREFIX: 'by' });
  const item = (section, i) => ({ ITEM_LINK_TEXT: `${section} item ${i + 1}`, ITEM_SOURCE: `Source ${i + 1}`, ITEM_URL: `https://example.com/${section}/${i + 1}` });
  issue = { id: 'ijnet-blueprints-test-001', edition: 'blueprints', locale: 'en', includeSurvey: true, values,
    columns: { INSIGHTS_ROW: Array.from({ length: 3 }, (_, i) => item('Research', i)), CASES_ROW: Array.from({ length: 3 }, (_, i) => item('Case', i)), BREAKDOWNS_ROW: [item('Breakdown', 0), item('Breakdown', 1)], SURVEY_CTA_ROW: [{}, {}], UPDATES_ROW: [{ HEADLINE: 'Example takeaway', SOURCE: 'Research source', URL: 'https://example.com/takeaway' }, { HEADLINE: 'Example announcement', SOURCE: 'News source', URL: 'https://example.com/announcement' }] },
    opportunities: Array.from({ length: 4 }, (_, i) => ({ id: `example-record-${i + 1}`, category: 'DESIGN', title: `Example opportunity ${i + 1}`, summary: 'Replace this sample with an Airtable opportunity.', deadline: '2026-12-31', url: `https://example.com/opportunity/${i + 1}` })) };
  await writeFile(new URL('issue.example.json', output), JSON.stringify(issue, null, 2) + '\n');
}
const { lexical, manifest } = compileNewsletter(source, issue);
const empty = compileNewsletter(source, { ...issue, opportunities: [] }).lexical;
const files = {
  'ijnet-newsletter.lexical.json': lexical,
  'ijnet-newsletter-empty.lexical.json': empty,
  'ijnet-newsletter.manifest.json': manifest,
  'ijnet-newsletter-draft.payload.json': { posts: [{ title: 'IJNet newsletter — template draft', status: 'draft', lexical: JSON.stringify(empty) }] }
};
for (const [name, value] of Object.entries(files)) await writeFile(new URL(name, output), JSON.stringify(value, null, 2) + '\n');
await writeFile(new URL('preview.html', output), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>IJNet template preview — sample content</title><style>body{max-width:960px;margin:40px auto;padding:20px;color:#242424;font:16px/1.55 Arial,sans-serif}a{color:#007ca3}h1,h2{font-family:Georgia,serif}h3{font-size:18px}td p{margin:8px 0}</style><body>${lexical.root.children.map(n => n.html).join('\n')}</body></html>`);
console.log('Generated full newsletter, empty grid, API payload, manifest and preview in output/newsletter-template.');
