import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { BskyAgent } from '@atproto/api';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import multer from 'multer'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// ====== 👇 ここから書き換え 👇 ======
const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.trim().replace(/\/$/, '').replace(/^http:/, 'https');
const supabase = createClient(cleanUrl, process.env.SUPABASE_ANON_KEY || '');

// 💡 【修正】Renderの環境変数が無い場合は、厳格なルールの通り「127.0.0.1」にフォールバックする
const RE_URL = process.env.RE_URL ? process.env.RE_URL.replace(/\/$/, '') : 'http://127.0.0.1:3000';
const FRONT_URL = process.env.FRONT_URL ? process.env.FRONT_URL.replace(/\/$/, '') : 'http://127.0.0.1:5173';

// 👑 【王道の解決策】OAuthクライアント設定
const oauthClient = new NodeOAuthClient({
  clientMetadata: {
    client_name: 'Liber3D',
    client_id: `${RE_URL}/client-metadata.json`,
    client_uri: FRONT_URL,
    redirect_uris: [`${RE_URL}/api/callback`],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
// ====== 👆 ここまで書き換え 👆 ======
  // ① ログイン進行中の「一時的な鍵」を入れる箱 (stateStore: { ... はそのまま残す)
  // ① ログイン進行中の「一時的な鍵」を入れる箱
  stateStore: {
    async set(key, val) {
      await supabase.from('oauth_states').upsert({ key, value: val, expires_at: new Date(Date.now() + 600000) });
    },
    async get(key) {
      const { data } = await supabase.from('oauth_states').select('value').eq('key', key).maybeSingle();
      return data ? data.value : undefined;
    },
    async del(key) {
      await supabase.from('oauth_states').delete().eq('key', key);
    }
  },
  // ② ログイン完了後の「ユーザーのセッション」を入れる箱（🚨 ここが欠落していたのが全エラーの元凶でした！）
  sessionStore: {
    async set(sub, sessionData) {
      await supabase.from('users').upsert({ did: sub, session: sessionData, updated_at: new Date() });
    },
    async get(sub) {
      const { data } = await supabase.from('users').select('session').eq('did', sub).maybeSingle();
      return data ? data.session : undefined;
    },
    async del(sub) {
      await supabase.from('users').delete().eq('did', sub);
    }
  }
});

const agent = new BskyAgent({ service: 'https://bsky.social' });

// ==========================================
// 🚀 3Dファイルのアップロード＆投稿API
// ==========================================
app.post('/api/post', upload.single('file'), async (req, res) => {
  const { did, text, partName } = req.body;
  const file = req.file;

  if (!did || !text || !partName || !file) {
    return res.status(400).json({ success: false, error: '必要なデータが不足しています。' });
  }

  try {
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('session')
      .eq('did', did)
      .single();

    if (dbError || !user) throw new Error('ユーザーのセッションが見つかりません。再ログインしてください。');

    const fileName = `${did}_${encodeURIComponent(partName)}.glb`;
    
    const { error: storageError } = await supabase
      .storage
      .from('models')
      .upload(fileName, file.buffer, {
        contentType: 'model/gltf-binary',
        upsert: true
      });

    if (storageError) throw new Error(`ストレージ保存失敗: ${storageError.message}`);

    await agent.resumeSession(user.session);
    await agent.post({
      text: text,
      createdAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('【投稿エラー】:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔒 ログイン＆コールバック ルーティング
// ==========================================
app.get('/api/login', async (req, res) => {
  try {
    const logParam = req.query.handle || '';
    const handle = logParam.trim().replace(/^@/, '');
    if (!handle) return res.status(400).json({ error: 'Handle is required' });

    const authUrl = await oauthClient.initiateLogin({
      handle: handle,
      state: Math.random().toString(36).substring(2),
    });
    
    res.json({ url: authUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/callback', async (req, res) => {
  try {
    // 💡 ライブラリが全自動で sessionStore の機能を使い、usersテーブルにデータを保存・検証してくれます
    const result = await oauthClient.callback(req.query);
    const did = result.session.did;

    const redirectUrl = process.env.FRONT_URL || '';
    res.redirect(`${redirectUrl}/?did=${did}`);
  } catch (error) {
    res.status(500).send(`Callback Error: ${error.message}`);
  }
});

// 本番環境用のスタティックファイル配信
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../dist/index.html'));
    } else {
      next();
    }
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});