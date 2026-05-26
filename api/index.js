import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { Agent } from '@atproto/api';
import dotenv from 'dotenv';

// 💡 .envファイルから設定を読み込む（プロの基本）
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scope = 'atproto transition:generic';

// 💡 コードからURLが完全に消え、環境変数から安全に読み込む形になりました
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const redirectUri = `${baseUrl}/callback`;
const clientId = `${baseUrl}/client-metadata.json`;

app.use(express.json());
app.use(cors());

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// ⚠️ ここは現在暫定のメモリですが、次のステップでここを本物のデータベースに繋ぎ変えます！
const memoryStore = new Map();
const stateStore = {
  async get(key) { return memoryStore.get(`state:${key}`); },
  async set(key, val) { memoryStore.set(`state:${key}`, val); },
  async del(key) { memoryStore.delete(`state:${key}`); },
};
const sessionStore = {
  async get(key) { return memoryStore.get(`session:${key}`); },
  async set(key, val) { memoryStore.set(`session:${key}`, val); },
  async del(key) { memoryStore.delete(`session:${key}`); },
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
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

app.listen(port, () => {
  console.log(`🚀 王道アーキテクチャサーバー起動中: ${baseUrl}`);
});