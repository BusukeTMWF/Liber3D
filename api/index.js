import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { Agent } from '@atproto/api';

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scope = 'atproto transition:generic';

// 💡 Renderが自動で発行してくれる本番URLを取得する魔法の環境変数
// （ローカルの時は自動で http://localhost:3000 になります）
const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
const redirectUri = `${baseUrl}/callback`;
const clientId = `${baseUrl}/client-metadata.json`;

app.use(express.json());
app.use(cors());

// 💡 本番環境（Render）の時は、Viteがビルドした画面（distフォルダ）をExpressが一緒に配信する
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

import { createClient } from '@supabase/supabase-js';

// 💡 Supabaseデータベースの起動
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 💡 【プロ仕様】一時的なメモリではなく、本物のデータベースに記憶を書き込むように変更！
const stateStore = {
  async get(key) {
    const { data } = await supabase.from('auth_store').select('value').eq('key', `state:${key}`).single();
    return data ? data.value : undefined;
  },
  async set(key, val) {
    await supabase.from('auth_store').upsert({ key: `state:${key}`, value: val });
  },
  async del(key) {
    await supabase.from('auth_store').delete().eq('key', `state:${key}`);
  },
};

const sessionStore = {
  async get(key) {
    const { data } = await supabase.from('auth_store').select('value').eq('key', `session:${key}`).single();
    return data ? data.value : undefined;
  },
  async set(key, val) {
    await supabase.from('auth_store').upsert({ key: `session:${key}`, value: val });
  },
  async del(key) {
    await supabase.from('auth_store').delete().eq('key', `session:${key}`);
  },
};

const client = new NodeOAuthClient({
  clientMetadata: {
    client_name: 'Liber3D',
    client_id: clientId,
    redirect_uris: [redirectUri],
    scope: scope,
    response_types: ['code'],
    grant_types: ['authorization_code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true
  },
  keyset: await Promise.all([
    JoseKey.generate(['ES256']),
  ]),
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

// 💡 本番環境（Render）の時、トップページにアクセスされたらViteの画面を返す
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// 💡 Render（常駐サーバー）では listen が絶対に必要なので、常に起動するように戻します
app.listen(port, () => {
  console.log(`🚀 サーバー起動中: ${baseUrl}`);
});