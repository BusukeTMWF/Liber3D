import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { BskyAgent } from '@atproto/api';
// 💡 新しい相棒：ブラウザから送られてきたファイルデータをNode.jsで安全に受け取るためのプラグイン
import multer from 'multer'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// メモリ上でファイルを一時保持する設定（サーバーのハードディスクを汚さない王道の設計）
const upload = multer({ storage: multer.memoryStorage() });

// データベースURLの自動整形（プロ仕様の防衛策）
const rawUrl = process.env.SUPABASE_URL || '';
const cleanUrl = rawUrl.trim().replace(/\/$/, '').replace(/^http:/, 'https');
const supabase = createClient(cleanUrl, process.env.SUPABASE_ANON_KEY || '');

const agent = new BskyAgent({ service: 'https://bsky.social' });

// ==========================================
// 🚀 【新規＆超重要】3Dファイルのアップロード＆投稿API
// ==========================================
// フロントから送られてくる「text」「did」「file（3Dデータ）」を一気に受け取ります
app.post('/api/post', upload.single('file'), async (req, res) => {
  const { did, text, partName } = req.body;
  const file = req.file; // 💡 これが送られてきた本物の .glb ファイル

  if (!did || !text || !partName || !file) {
    return res.status(400).json({ success: false, error: '必要なデータが不足しています。' });
  }

  try {
    // 1. まず、Supabaseから「このユーザーのログイン鍵（セッション）」を引っ張り出す
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('session')
      .eq('did', did)
      .single();

    if (dbError || !user) throw new Error('ユーザーのセッションが見つかりません。再ログインしてください。');

    // 2. 【心臓部】Supabaseのストレージ（modelsバケット）にファイルを保存する
    // ファイル名は「ユーザーのDID_作品名.glb」という、世界で絶対に重複しない王道の命名規則にします
    const fileName = `${did}_${encodeURIComponent(partName)}.glb`;
    
    const { data: storageData, error: storageError } = await supabase
      .storage
      .from('models')
      .upload(fileName, file.buffer, {
        contentType: 'model/gltf-binary', // GLBファイルの標準MIMEタイプ
        upsert: true // 💡 同じ名前のファイルが来たら自動で上書き更新するプロの設定
      });

    if (storageError) throw new Error(`ストレージ保存失敗: ${storageError.message}`);

    // 3. Blueskyへ自動ポストを投げる
    await agent.resumeSession(user.session);
    await agent.post({
      text: text,
      createdAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('【本本エラー】:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// OAuthログイン等の既存のAPIルート（省略せずにそのまま保持）
app.get('/api/login', async (req, res) => {
  try {
    const logParam = req.query.handle || '';
    const handle = logParam.trim().replace(/^@/, '');
    if (!handle) return res.status(400).json({ error: 'Handle is required' });

    const authUrl = await agent.oauth.initiateLogin({
      handle: handle,
      redirectUri: process.env.RE_URL || ''
    });
    res.json({ url: authUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/callback', async (req, res) => {
  try {
    const result = await agent.oauth.callback(req.query);
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

// 本番環境（Render）用のスタティックファイル配信（PathError完全防御型）
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