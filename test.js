import { BskyAgent } from '@atproto/api';

// 1. 接続するためのエージェント（身代わり）を作る
const agent = new BskyAgent({ service: 'https://bsky.social' });

async function main() {
  try {
    // 2. ログインする（ここに自分の情報を入れます）
    await agent.login({
      identifier: 'shunsukehirano.bsky.social', // 例: user.bsky.social
      password: 'xdxw-j22u-bopk-2vch'      // 例: abcd-efgh-ijkl-mnop
    });
    console.log('🎉 ログインに成功しました！');

    // 3. 自分のプロフィール情報を取得してみる
    const profile = await agent.getProfile({ actor: agent.session.did });
    
    console.log('--- あなたのプロフィール情報 ---');
    console.log(`名前: ${profile.data.displayName}`);
    console.log(`自己紹介: ${profile.data.description}`);
    console.log('---------------------------------');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
  }
}

main();