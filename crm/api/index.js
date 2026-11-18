// The whole CRM as one Vercel Function. vercel.json sends every path that isn't a file in public/ here;
// req.url keeps the original path (/webhook, /api/leads, …).
import { handle } from '../lib/app.js';

export default handle;
