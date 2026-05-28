import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { BskyAgent } from '@atproto/api'; // 💡 通常のタイムライン投稿用
import { NodeOAuthClient } from '@atproto/oauth-client-node'; // 💡 ログインエラーを絶対防ぐための本尊
import multer from 'multer'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Supabaseクライアントの初期化
const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.trim().replace(/\/$/, '').replace(/^http:/, 'https');
const supabase = createClient(cleanUrl, process.env.SUPABASE_ANON_KEY || '');

// 💡 【超重要：エラー解決の鍵】
// initiateLogin を絶対に失敗させないために、OAuthクライアントを正しく初期化します
const oauthClient = new NodeOAuthClient({
  clientMetadata: {
    client_name: 'Liber3D',
    client_id: process.env.RE_URL ? `${process.env.RE_URL}/client-metadata.json` : 'http://localhost:3000/client-metadata.json',
    client_uri: process.env.FRONT_URL || 'http://localhost:5173',
    redirect_uris: [process.env.RE_URL ? `${process.env.RE_URL}/api/callback` : 'http://localhost:3000/api/callback'],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  },
  stateStore: {
    // State（一時的な鍵）の保存先として、Supabaseの強固なデータベースを使い回す王道設計
    async set(key, val) {
      await supabase.from('oauth_states').upsert({ key, value: val, expires_at: new Date(Date.now() + 600000) });
    },
    async get(key) {
      const { data } = await supabase.from('oauth_states').select('value').eq('key', key).single();
      return data ? data.value : undefined;
    },
    async del(key) {
      await supabase.from('oauth_states').delete().eq('key', key);
    }
  }
});

// 通常の投稿などで使うエージェント
const agent = new BskyAgent({ service: 'https://bsky.social' });

// ==========================================
// 🚀 3Dファイルのアップロード＆投稿API（ここはそのまま維持）
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
    console.error('【本尊エラー】:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🔒 【修正】エラーをねじ伏せる新しいログインルーティング
// ==========================================
app.get('/api/login', async (req, res) => {
  try {
    const logParam = req.query.handle || '';
    const handle = logParam.trim().replace(/^@/, '');
    if (!handle) return res.status(400).json({ error: 'Handle is required' });

    // 💡 oauthClient から正しくログインURLを生成します（これで undefined エラーは消滅します）
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
    // 💡 コールバックも新しい oauthClient で安全に処理
    const result = await oauthClient.callback(req.query);
    const session = result.session;
    const did = session.did;

    const { error: dbError } = await supabase
      .from('users')
      .upsert({ did: did, session: session, updated_at: new Date() });

    if (dbError) throw dbError;

    const redirectUrl = process.env.FRONT_URL || '';
    res.redirect(`${redirectUrl}/?did=${did}`);
  } catch (error) {
    res.status(500).send(`Callback Error: ${error.message}`);
  }
});

// 以下、本番環境用のスタティックファイル配信（変更なし）
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