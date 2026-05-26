import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { Agent } from '@atproto/api';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.set('trust proxy', true);

const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scope = 'atproto transition:generic';

let baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
if (baseUrl.endsWith('/')) {
  baseUrl = baseUrl.slice(0, -1);
}

app.use(express.json());
app.use(cors());

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 💡 【デプロイ最後の王道設計】エラーを隠さず、その場でスローして画面に原因を表示させる
const stateStore = {
  async get(key) {
    const { data, error } = await supabase.from('auth_store').select('value').eq('key', `state:${key}`).maybeSingle();
    if (error) throw new Error(`DBからの鍵取得に失敗: ${error.message} (${error.details || ''})`);
    return data ? data.value : undefined;
  },
  async set(key, val) {
    const { error } = await supabase.from('auth_store').upsert({ key: `state:${key}`, value: val });
    if (error) throw new Error(`DBへの鍵保存に失敗: ${error.message} (${error.details || ''})`);
  },
  async del(key) {
    const { error } = await supabase.from('auth_store').delete().eq('key', `state:${key}`);
    if (error) throw new Error(`DBからの鍵削除に失敗: ${error.message} (${error.details || ''})`);
  },
};

const sessionStore = {
  async get(key) {
    const { data, error } = await supabase.from('auth_store').select('value').eq('key', `session:${key}`).maybeSingle();
    if (error) throw new Error(`DBからのセッション取得に失敗: ${error.message} (${error.details || ''})`);
    return data ? data.value : undefined;
  },
  async set(key, val) {
    const { error } = await supabase.from('auth_store').upsert({ key: `session:${key}`, value: val });
    if (error) throw new Error(`DBへのセッション保存に失敗: ${error.message} (${error.details || ''})`);
  },
  async del(key) {
    const { error } = await supabase.from('auth_store').delete().eq('key', `session:${key}`);
    if (error) throw new Error(`DBからのセッション削除に失敗: ${error.message} (${error.details || ''})`);
  },
};

const client = new NodeOAuthClient({
  clientMetadata: {
    client_name: 'Liber3D',
    client_id: `${baseUrl}/client-metadata.json`,
    redirect_uris: [`${baseUrl}/callback`],
    scope: scope,
    response_types: ['code'],
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true
  },
  keyset: await Promise.all([JoseKey.generate(['ES256'])]),
  stateStore: stateStore,
  sessionStore: sessionStore,
});

app.get('/client-metadata.json', (req, res) => {
  res.json(client.clientMetadata);
});

app.get('/api/login', async (req, res) => {
  const handle = req.query.handle;
  if (!handle) return res.status(400).send('Handle is required');
  try {
    const url = await client.authorize(handle, { scope: scope });
    res.redirect(url);
  } catch (error) {
    // 💡 ここでSupabaseの保存エラーが起きていれば、即座に画面に表示されます！
    res.status(500).send('OAuth開始エラー: ' + error.message);
  }
});

app.get('/callback', async (req, res) => {
  const params = new URLSearchParams(req.query);
  try {
    const { session } = await client.callback(params);
    res.redirect(`${baseUrl}/?did=${session.did}`);
  } catch (error) {
    res.status(500).send('認証完了エラー: ' + error.message);
  }
});

app.post('/api/post', async (req, res) => {
  const { did, text } = req.body;
  try {
    const oauthSession = await client.restore(did);
    const agent = new Agent(oauthSession);
    await agent.post({
      text: text,
      createdAt: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

export default app;

app.listen(port, () => {
  console.log(`🚀 鉄壁サーバー起動中（ポート: ${port}）`);
});