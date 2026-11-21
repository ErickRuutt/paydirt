import { clerkClient } from '@clerk/express';
import { one, run } from './db.js';
import { newId } from './ids.js';
import { httpError } from './mireye.js';

// In-app feedback: saved in Postgres first (so nothing is lost), then copied to a Notion table
// for review. Notion needs NOTION_TOKEN (an internal integration with access to the Feedback page)
// and NOTION_FEEDBACK_DB (created by `npm run setup:notion`).
export const FEEDBACK_KINDS = { idea: 'Idea', problem: 'Problem', question: 'Question', data: 'Data issue' };
const NOTION_VERSION = '2022-06-28';
export const hasNotion = () => Boolean(process.env.NOTION_TOKEN && process.env.NOTION_FEEDBACK_DB);

async function whoIs(clerkUserId) {
  try {
    const u = await clerkClient.users.getUser(clerkUserId);
    const email = u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ?? u.emailAddresses?.[0]?.emailAddress ?? null;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || email || 'Unknown';
    return { name, email };
  } catch { return { name: 'Unknown', email: null }; }
}

// Notion caps each rich-text piece at 2,000 characters.
const chunks = (s) => (s.match(/[\s\S]{1,2000}/g) ?? ['']).slice(0, 100).map((t) => ({ type: 'text', text: { content: t } }));

async function sendToNotion(f) {
  const title = f.message.split('\n')[0].slice(0, 120);
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_FEEDBACK_DB },
      properties: {
        Feedback: { title: [{ type: 'text', text: { content: title || '(no text)' } }] },
        Details: { rich_text: chunks(f.message) },
        Type: { select: { name: FEEDBACK_KINDS[f.kind] } },
        'Logged by': { rich_text: [{ type: 'text', text: { content: f.name } }] },
        Email: { email: f.email },
        'Logged at': { date: { start: f.createdAt } },
        Page: { rich_text: [{ type: 'text', text: { content: f.page ?? '' } }] },
        Status: { select: { name: 'New' } },
        ID: { rich_text: [{ type: 'text', text: { content: f.uid } }] },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Notion returned ${res.status}`);
  return body.id;
}

export async function logFeedback(user, clerkUserId, { message, kind, page } = {}) {
  message = String(message ?? '').trim();
  if (!message) throw httpError(400, 'Write something first.');
  if (message.length > 10_000) throw httpError(400, 'That is over 10,000 characters; trim it a little.');
  kind = FEEDBACK_KINDS[kind] ? kind : 'idea';
  page = page ? String(page).slice(0, 300) : null;
  const { name, email } = await whoIs(clerkUserId);
  const uid = newId('fbk');
  const row = await one(`INSERT INTO feedback (feedback_uid, user_uid, org_uid, name, email, kind, message, page)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING created_at`, [uid, user?.uid ?? null, user?.orgUid ?? null, name, email, kind, message, page]);
  let sentToNotion = false;
  if (hasNotion()) {
    try {
      const pageId = await sendToNotion({ uid, name, email, kind, message, page, createdAt: new Date(row.created_at).toISOString() });
      await run('UPDATE feedback SET notion_page_id = ? WHERE feedback_uid = ?', [pageId, uid]);
      sentToNotion = true;
    } catch (e) {
      await run('UPDATE feedback SET notion_error = ? WHERE feedback_uid = ?', [e.message.slice(0, 500), uid]);
    }
  }
  return { id: uid, sentToNotion };
}
