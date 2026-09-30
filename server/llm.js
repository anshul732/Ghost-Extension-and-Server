const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_RECORDS = 200;
const SUMMARY_CHARS = 600;
const TIMEOUT_MS = 30000;
const DAY_MS = 86400000;

const SYSTEM = `You help editors of a global "opportunities" newsletter decide which opportunities to feature. Do NOT judge topic fit.
Score each opportunity 0-100 for how strongly it should be featured, weighing three things:
- Urgency: sooner deadlines rank higher. An opportunity whose deadline has already passed (negative daysToDeadline) must score near 0 — never feature it.
- Geographic reach: prefer opportunities open globally or worldwide. Ones limited to a region or continent are acceptable but rank lower; ones limited to a single country rank lower still.
- Funder: prefer reputable, legitimate sponsoring organizations.
For each opportunity also return the funder's country. Use the provided funderCountry when given; otherwise infer it from the organization and text. Return "unknown" if you genuinely cannot tell — accuracy matters because a separate system removes funders from specific states.
Give a reason of at most 14 words. Score every opportunity using its exact id. Respond only with the tool call.`;

const TOOL = {
  name: 'submit_relevance',
  description: 'Return a feature-priority score, short reason, and funder country for every opportunity provided.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scores'],
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'score', 'reason', 'country'],
          properties: {
            id: { type: 'string' },
            score: { type: 'integer' },
            reason: { type: 'string' },
            country: { type: 'string' }
          }
        }
      }
    }
  }
};

export function relevanceAdapter({ apiKey, model = 'claude-sonnet-5', workspaceId }, fetcher = fetch) {
  const authHeaders = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}) };
  return {
    // Returns Map<recordId, { score, reason, country }>. Never throws: a scoring
    // failure degrades to an empty map so the review workflow keeps working.
    async score(today, records) {
      const items = records.slice(0, MAX_RECORDS).map(r => {
        const item = { id: r.id, title: r.title || '', organization: r.organization || '', category: r.category || '', deadline: r.deadline || '', summary: (r.summary || '').slice(0, SUMMARY_CHARS) };
        if (r.deadline) { const days = Math.round((Date.parse(`${r.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS); if (Number.isFinite(days)) item.daysToDeadline = days; }
        if (r.region) item.region = r.region;
        if (r.funderCountry) item.funderCountry = r.funderCountry;
        return item;
      });
      if (!items.length) return new Map();
      const body = {
        model,
        max_tokens: Math.min(16000, 1024 + items.length * 70),
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'submit_relevance' },
        messages: [{ role: 'user', content: `Today is ${today}.\n\nOpportunities (JSON):\n${JSON.stringify(items)}` }]
      };
      let response;
      try {
        response = await fetcher(ANTHROPIC_URL, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: authHeaders,
          body: JSON.stringify(body)
        });
      } catch (error) {
        console.error(`Relevance scoring: could not reach Anthropic (${error.name}: ${error.message}).`);
        return new Map();
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error(`Relevance scoring: Anthropic returned ${response.status}. ${detail.slice(0, 400)}`);
        return new Map();
      }
      let data;
      try { data = await response.json(); } catch { console.error('Relevance scoring: Anthropic response was not JSON.'); return new Map(); }
      if (data?.usage) console.error('Relevance usage:', JSON.stringify(data.usage));
      const block = (data?.content || []).find(b => b.type === 'tool_use' && b.name === 'submit_relevance');
      const scores = block?.input?.scores;
      if (!Array.isArray(scores)) return new Map();
      const map = new Map();
      for (const s of scores) {
        if (s && typeof s.id === 'string' && Number.isFinite(s.score)) {
          map.set(s.id, {
            score: Math.max(0, Math.min(100, Math.round(s.score))),
            reason: typeof s.reason === 'string' ? s.reason.slice(0, 120) : '',
            country: typeof s.country === 'string' ? s.country.slice(0, 60) : ''
          });
        }
      }
      return map;
    }
  };
}
