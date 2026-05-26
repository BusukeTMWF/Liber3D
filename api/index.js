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
// Renderのプロキシ（中継器）を信頼し、https通信を正しく維持する設定
app.set('trust proxy', true);

const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scope = 'atproto transition:generic';

// 💡 【王道・自動化】入力ミスを防ぐため、手動設定は見ず、Renderの自動発行URLのみを100%信用する
let baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

// 💡 【安全装置】万が一、URLの末尾に「/」が入っていた場合はプログラムが自動で綺麗に削除する
if (baseUrl.endsWith('/')) {
  baseUrl = baseUrl.slice(0, -1);
}

app.use(express.json());
app.use(cors());

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
  console.log(`🚀 サーバー起動中（ポート: ${port}）`);
});