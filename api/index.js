import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { Agent } from '@atproto/api'; // 💡 BskyAgent ではなく Agent を使います！
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import multer from 'multer'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// データベースとURLの安全な初期化
const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.trim().replace(/\/$/, '').replace(/^http:/, 'https');
const supabase = createClient(cleanUrl, process.env.SUPABASE_ANON_KEY || '');

const RE_URL = process.env.RE_URL ? process.env.RE_URL.replace(/\/$/, '') : 'http://127.0.0.1:3000';
const FRONT_URL = process.env.FRONT_URL ? process.env.FRONT_URL.replace(/\/$/, '') : 'http://127.0.0.1:5173';

// 👑 【完全解決策】名刺データ（メタデータ）を1つの変数に固定する
const clientMetadata = {
  client_name: 'Liber3D',
  client_id: `${RE_URL}/client-metadata.json`,
  client_uri: FRONT_URL,
  redirect_uris: [`${RE_URL}/api/callback`],
  scope: 'atproto transition:generic',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  application_type: 'web', // 💡 念のため「Webアプリです」という宣言も入れておくと完璧です
  dpop_bound_access_tokens: true // 👈 【新規追加】これを書かないとBlueskyに弾かれます！
};

// OAuthクライアントに固定した名刺を渡す
// 👑 【修正】オブジェクトデータをJSONテキストに変換して安全に保存・解凍する
const oauthClient = new NodeOAuthClient({
  clientMetadata: clientMetadata,
  
  // ① ログイン進行中の「一時的な鍵」を入れる箱
  stateStore: {
    async set(key, val) {
      // 💡 保存時に val を JSON 文字列にパック（stringify）する！
      await supabase.from('oauth_states').upsert({ 
        key, 
        value: JSON.stringify(val), 
        expires_at: new Date(Date.now() + 600000) 
      });
    },
    async get(key) {
      const { data } = await supabase.from('oauth_states').select('value').eq('key', key).maybeSingle();
      if (!data) return undefined;
      try {
        // 💡 取得時に JSON 文字列を元のオブジェクトに解凍（parse）する！
        return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      } catch (e) {
        return undefined;
      }
    },
    async del(key) {
      await supabase.from('oauth_states').delete().eq('key', key);
    }
  },

  // ② ログイン完了後の「ユーザーのセッション」を入れる箱
  sessionStore: {
    async set(sub, sessionData) {
      // 💡 こちらも同様にパックする！
      await supabase.from('users').upsert({ 
        did: sub, 
        session: JSON.stringify(sessionData), 
        updated_at: new Date() 
      });
    },
    async get(sub) {
      const { data } = await supabase.from('users').select('session').eq('did', sub).maybeSingle();
      if (!data) return undefined;
      try {
        // 💡 こちらも解凍する！
        return typeof data.session === 'string' ? JSON.parse(data.session) : data.session;
      } catch (e) {
        return undefined;
      }
    },
    async del(sub) {
      await supabase.from('users').delete().eq('did', sub);
    }
  }
});

const agent = new Agent({ service: 'https://bsky.social' });

// ==========================================
// 🚀 名刺の配信ルート（固定した名刺と全く同じものを返す）
// ==========================================
app.get('/client-metadata.json', (req, res) => {
  res.json(clientMetadata);
});

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
    // 👑 【完全自動化】ライブラリに「このDIDのユーザーの鍵を復元して！」とお願いするだけ！
    // （裏側で勝手にSupabaseの sessionStore を読みに行ってくれます）
    const userSession = await oauthClient.restore(did);
    if (!userSession) {
      throw new Error('セッションが見つかりません。再ログインしてください。');
    }

    // 💡 ファイル名は16進数で安全に処理（先ほどの修正のまま）
    const safeDid = did.replaceAll(':', '-');
    const safeName = Buffer.from(partName, 'utf8').toString('hex');
    const fileName = `${safeDid}_${safeName}.glb`;
    
    const { error: storageError } = await supabase
      .storage
      .from('models')
      .upload(fileName, file.buffer, {
        contentType: 'model/gltf-binary',
        upsert: true
      });

    if (storageError) throw new Error(`ストレージ保存失敗: ${storageError.message}`);

    // 👑 【最新の投稿方式】復元した OAuth セッションを使って、最新の Agent を起動！
    const agent = new Agent(userSession);
    
    // Blueskyへポスト！
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

    const authUrl = await oauthClient.authorize(handle, {
      scope: 'atproto transition:generic'
    });
    
    res.json({ url: authUrl.toString() });
  } catch (error) {
    console.error('Login API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/callback', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query);
    const { session } = await oauthClient.callback(params);
    const did = session.sub || session.did;

    res.redirect(`${FRONT_URL}/?did=${did}`);
  } catch (error) {
    console.error('Callback API Error:', error);
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