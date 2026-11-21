// Copy feedback that never reached Notion. Usage: npm run feedback:resend (uses .env, i.e. production).
import { resendPending } from '../src/feedback.js';
import { pool } from '../src/db.js';
console.log(await resendPending());
await pool.end();
