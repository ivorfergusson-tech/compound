// Edge Function: marks one written answer. Secrets (set in Supabase, never in this repo): ANTHROPIC_API_KEY.
// With no key it replies "off", so the site behaves as it did. Deploy steps are in SETUP.md.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { markAnswer } from './core.js';

const MODEL = 'claude-sonnet-5-5';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const claude = () => {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  return {
    async mark(system: string, schema: object, prompt: string) {
      const r = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      } as never) as any;
      if (r.stop_reason !== 'end_turn') throw new Error(r.stop_reason);
      const text = r.content.find((b: any) => b.type === 'text')?.text;
      return { output: JSON.parse(text), input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, model: r.model };
    },
  };
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return reply({ status: 'off' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return reply({ status: 'denied' }, 401);
  const { sub, position } = await req.json();
  const db = {
    async rpc(name: string, args: object) {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw error;
      return data;
    },
  };
  try {
    return reply(await markAnswer({ user: user.id, sub, position }, { db, model: claude() }));
  } catch {
    return reply({ status: 'denied' }, 403); // ai_begin refused: not this person's work
  }
});
