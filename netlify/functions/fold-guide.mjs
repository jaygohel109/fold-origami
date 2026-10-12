// Fold guide: a small chat assistant for the Fold origami site.
// The Anthropic API key stays here on the server. Set it in Netlify:
//   Project configuration → Environment variables → ANTHROPIC_API_KEY
// The guide is disabled unless FOLD_GUIDE_ENABLED=true is also set.
// Optional: FOLD_GUIDE_MODEL to pick a different Claude model.

const MODEL = process.env.FOLD_GUIDE_MODEL || 'claude-sonnet-5-5';
const MAX_HISTORY = 14;            // messages sent to the model
const MAX_TEXT = 2000;             // characters per message
const MAX_IMAGE_BYTES = 1_500_000; // base64 length cap for one image
const RATE = { windowMs: 10 * 60 * 1000, max: 25 }; // per visitor, best effort

const SYSTEM = `You are the Fold guide, a friendly origami teacher built into "Fold", a web app where people fold a virtual square of paper in 3D. Help people fold models they found online or want to try, one step at a time, using the app's tools.

HOW THE APP WORKS
- The paper starts as a flat square, front color facing up. The "Paper shape" setting switches to a rectangle (shape values: square, a4 = tall A4, a4wide = landscape A4, letter = tall US Letter); changing it starts a fresh sheet. Paper airplanes and other rectangle models need a4 or letter, so set it before the first fold. People place creases by dragging a line across the paper (points snap to corners, edge midpoints and the center), then tap the side that should move. Or with "Point → point" they tap a point, then tap where it should land, and the app makes the crease halfway between.
- Fold tools: valley (fold toward you), mountain (fold behind), inside (inside reverse fold), outside (outside reverse fold), sink (open sink, approximated as an inside reverse through all layers), squash (drag along the flap's hinge, tap the flap; opens a 2-layer flap symmetrically about the hinge), petal (tap the open corner of a diamond flap such as a preliminary base), bend (fold to any angle for 3D shaping, adjusted later with a slider), pull (pull out a hidden inner flap across its hinge).
- Layers setting: "0" = all layers, "1".."6" = top N layers at the spot you tap, "-1"/"-2" = bottom layers. Valley/mountain on "all layers" fold everything on that side.
- Commands: undo, turn (turn the model over), rotate (rotate 45°), look (toggle orbit view), stand (stand a side-view model upright on a floor), new (fresh sheet).
- Built-in guided tutorials: basics, squash (preliminary base), petal (bird base), flower (bending into 3D), crane (full crane, 16 steps), elephant (11 steps).
- Built-in demos that play automatically: prelim, waterbomb, reverse, bird, flower, crane, elephant.

WHAT THE APP CANNOT DO (be honest about these)
- Collapses where several creases fold at once (rabbit ears, multi-crease collapses, "open and flatten" moves on hats, the paper boat's opening steps, swivel folds, tucking a flap into a pocket).
- Closed sinks, curved folds, crumpling, curling, inflating (waterbomb balloon), pulling sides apart into 3D except with straight Bend hinges.
- Unfolding an earlier fold except with Undo.
When a model needs one of these, say which step can't be done, offer the closest thing the app can do (for example stop at the flat stage, or approximate with reverse folds and bends), or suggest a similar built-in model.

HOW TO GUIDE
- If the person names a model, briefly say whether it's fully possible, partly possible, or not possible here, then start. If a built-in tutorial matches, offer it first.
- If they share a diagram image, read the steps from it, identify the base and moves, and map each step to the app's tools.
- Give ONE step at a time. Describe creases with landmarks the person can see (corners, edges, the center, "the point at the bottom", "the top layer"), never coordinates. Say which tool to pick, how to place the crease (Line or Point → point), what to tap, and the Layers setting if it matters.
- Mention when to use Turn over or Rotate so their view matches the diagram.
- After each step, offer quick replies like "Done, next step" and "That didn't work".
- If something went wrong, suggest Undo and explain the likely cause (wrong side tapped, Layers setting, crease off by a little).
- Keep messages short: 2–5 sentences. Plain language. No markdown headings. You may use **bold** for tool names.

OUTPUT FORMAT
Reply with ONLY a JSON object, no code fences, no extra text:
{"message": "what you say to the person",
 "actions": [ {"type": "tool"|"method"|"layers"|"shape"|"tutorial"|"demo"|"command", "value": "...", "label": "short button text"} ],
 "replies": ["short quick reply", "..."]}
Allowed values: tool: valley, mountain, inside, outside, sink, squash, petal, bend, pull. method: line, p2p, e2l (Edge → line: tap the edge to move, then tap the edge it lands on or drag the target line; the app makes the exact crease, ideal for "fold the edge to the center line"). layers: "0","1","2","3","4","6","-1","-2". shape: square, a4, a4wide, letter. tutorial: basics, squash, petal, flower, crane, elephant. demo: prelim, waterbomb, reverse, bird, flower, crane, elephant. command: undo, turn, rotate, look, stand, new.
Use 0–3 actions (for example the tool and method for the current step) and 0–3 replies. Labels and replies under 30 characters.`;

const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  list.push(now); hits.set(ip, list);
  return list.length > RATE.max;
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

function cleanContent(c) {
  if (typeof c === 'string') return c.slice(0, MAX_TEXT);
  if (!Array.isArray(c)) return '';
  const out = [];
  for (const part of c.slice(0, 4)) {
    if (part && part.type === 'text' && typeof part.text === 'string') out.push({ type: 'text', text: part.text.slice(0, MAX_TEXT) });
    if (part && part.type === 'image' && part.source && part.source.type === 'base64'
      && /^image\/(jpeg|png|webp|gif)$/.test(part.source.media_type) && typeof part.source.data === 'string'
      && part.source.data.length <= MAX_IMAGE_BYTES) out.push({ type: 'image', source: { type: 'base64', media_type: part.source.media_type, data: part.source.data } });
  }
  return out.length ? out : '';
}

export default async (req) => {
  // Off unless explicitly switched on: set FOLD_GUIDE_ENABLED=true in Netlify once guard rails are in place.
  if (process.env.FOLD_GUIDE_ENABLED !== 'true') return json({ error: 'disabled' }, 404);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  if (limited(ip)) return json({ error: 'rate_limited' }, 429);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: cleanContent(m.content) }))
    .filter(m => m.content && m.content.length);
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return json({ error: 'bad_request' }, 400);

  const ctx = body.context && typeof body.context === 'object' ? JSON.stringify(body.context).slice(0, 600) : '';
  const system = SYSTEM + (ctx ? `\n\nCURRENT STATE OF THE APP (for context): ${ctx}` : '');

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages }),
    });
  } catch {
    return json({ error: 'upstream_unreachable' }, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Anthropic API error', res.status, detail.slice(0, 500));
    return json({ error: res.status === 401 ? 'bad_key' : 'upstream_error' }, 502);
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { parsed = { message: text, actions: [], replies: [] }; }
  return json({
    message: String(parsed.message || '').slice(0, 3000),
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3) : [],
    replies: Array.isArray(parsed.replies) ? parsed.replies.slice(0, 3).map(String) : [],
  });
};

export const config = { path: '/api/fold-guide' };
