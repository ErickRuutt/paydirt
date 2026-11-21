// One-time: create the "Feedback log" table inside Notion's "Paydirt build plan" › "Feedback" page.
// Needs NOTION_TOKEN in .env (an internal integration; share the Feedback page with it first).
// Usage: npm run setup:notion   → prints NOTION_FEEDBACK_DB to add to .env and to Vercel.
const token = process.env.NOTION_TOKEN;
if (!token) { console.error('Add NOTION_TOKEN to .env first (see README › Feedback).'); process.exit(2); }
const notion = async (path, body, method = body ? 'POST' : 'GET') => {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'notion-version': '2022-06-28', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.message ?? res.status}`);
  return json;
};
const titleOf = (page) => Object.values(page.properties ?? {}).find((p) => p.type === 'title')?.title?.map((t) => t.plain_text).join('') ?? '';

const { results } = await notion('search', { query: 'Feedback', filter: { property: 'object', value: 'page' } });
let target = null;
for (const p of results.filter((r) => titleOf(r).trim().toLowerCase() === 'feedback')) {
  if (p.parent?.type !== 'page_id') continue;
  const parent = await notion(`pages/${p.parent.page_id}`);
  if (titleOf(parent).trim().toLowerCase() === 'paydirt build plan') { target = p; break; }
}
if (!target) {
  console.error('Could not see a "Feedback" page under "Paydirt build plan". In Notion, open the Feedback page → ••• → Connections → add your integration, then rerun.');
  process.exit(1);
}

const sel = (names) => ({ select: { options: names.map(([name, color]) => ({ name, color })) } });
const db = await notion('databases', {
  parent: { type: 'page_id', page_id: target.id },
  title: [{ type: 'text', text: { content: 'Feedback log' } }],
  is_inline: true,
  properties: {
    Feedback: { title: {} },
    Type: sel([['Idea', 'green'], ['Problem', 'red'], ['Question', 'blue'], ['Data issue', 'yellow']]),
    Status: sel([['New', 'gray'], ['Reviewing', 'yellow'], ['Planned', 'blue'], ['Done', 'green'], ["Won't do", 'red']]),
    'Logged by': { rich_text: {} },
    Email: { email: {} },
    'Logged at': { date: {} },
    Page: { rich_text: {} },
    Details: { rich_text: {} },
    ID: { rich_text: {} },
  },
});
console.log(`Created "Feedback log" in Paydirt build plan › Feedback.\nAdd this to .env and to Vercel:\nNOTION_FEEDBACK_DB=${db.id}`);
