import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { GLTFLoader } from 'three-stdlib';

let isLoggedIn = false;
let isFileLoaded = false;
let userDid = null;
let currentMesh = null;
let rawUploadedFile = null; // 💡 投稿するために、ドロップされたファイルを生データとして記憶する変数

const urlParams = new URLSearchParams(window.location.search);
const didParam = urlParams.get('did');     
const nameParam = urlParams.get('name');   
const isViewMode = didParam && nameParam;  

// ==========================================
// 1. 画面の表示切り替え（UIコントロール）
// ==========================================
if (isViewMode) {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('profile-area').style.display = 'none';
    document.getElementById('upload-form').style.display = 'none';
    
    const header = document.createElement('div');
    header.id = 'viewer-header';
    header.innerHTML = `<h1>🎨 ${nameParam}</h1><p>Created by: ${didParam.substring(0, 15)}...</p>`;
    document.body.appendChild(header);
} else {
    if (didParam) {
        userDid = didParam;
        isLoggedIn = true;
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('profile-area').style.display = 'block';
        document.getElementById('upload-form').style.display = 'block';
        document.getElementById('welcome-msg').innerText = `✨ ログイン完了！\n(ID: ${didParam.substring(0, 15)}...)`;
        window.history.replaceState({}, document.title, "/");
    }
}

// ==========================================
// 🚀 ログインボタンを押したときの処理（ポップアップなし版）
// ==========================================
const loginBtn = document.getElementById('login-btn');
const handleInput = document.getElementById('bsky-handle'); // 💡 画面の入力欄を取得

if (loginBtn && handleInput) {
    loginBtn.addEventListener('click', async () => {
        // 入力欄からハンドル名を読み取り、前後の空白を消す
        const handle = handleInput.value.trim();
        
        if (!handle) {
            alert('Blueskyのハンドル名を入力してください！\n（例: yourname.bsky.social）');
            return;
        }

        loginBtn.innerText = '認証画面へ移動中...';
        loginBtn.disabled = true;
        handleInput.disabled = true; // 💡 通信中は入力欄もロックするプロの気遣い

        try {
            const response = await fetch(`/api/login?handle=${encodeURIComponent(handle)}`);
            const data = await response.json();

            if (data.url) {
                // 認証URLへジャンプ！
                window.location.href = data.url;
            } else {
                alert('ログインエラー: ' + (data.error || '不明なエラー'));
                loginBtn.innerText = 'Blueskyでログイン';
                loginBtn.disabled = false;
                handleInput.disabled = false;
            }
        } catch (error) {
            alert('通信エラー: ' + error.message);
            loginBtn.innerText = 'Blueskyでログイン';
            loginBtn.disabled = false;
            handleInput.disabled = false;
        }
    });
}

// ==========================================
// 2. 投稿ボタンを押したときの処理（ファイル同梱・マルチパート送信）
// ==========================================
document.getElementById('upload-btn').addEventListener('click', async () => {
    const partName = document.getElementById('part-name').value;
    if (!partName || !rawUploadedFile) return;

    const uploadBtn = document.getElementById('upload-btn');
    try {
        uploadBtn.innerText = '3Dデータを倉庫に保存中...';
        uploadBtn.disabled = true;

        const currentUrl = window.location.origin;
        const shareUrl = `${currentUrl}/?did=${userDid}&name=${encodeURIComponent(partName)}`;
        const postText = `【Liber3D】\n3D作品「${partName}」を登録しました！\nブラウザでグリグリ動かして見られます！👇\n${shareUrl}\n\n#Liber3D`;

        // 💡 ファイルと文字を同時に送るため、「FormData」という箱に荷物を詰める（WEBの王道技術）
        const formData = new FormData();
        formData.append('did', userDid);
        formData.append('partName', partName);
        formData.append('text', postText);
        formData.append('file', rawUploadedFile); // 本物のファイルデータを同梱！

        const response = await fetch('/api/post', {
            method: 'POST',
            body: formData // ⚠️ Content-Typeヘッダーはブラウザが自動設定するのでここでは書かないのがプロの鉄則
        });

        const result = await response.json();
        if (result.success) {
            alert(`🎉「${partName}」を倉庫に保存し、Blueskyにシェアしました！`);
            document.getElementById('part-name').value = '';
            rawUploadedFile = null;
        } else {
            alert('投稿エラー: ' + result.error);
        }
    } catch (error) {
        alert('通信エラー: ' + error.message);
    } finally {
        uploadBtn.innerText = 'Liber3Dに作品を投稿する';
        uploadBtn.disabled = false;
    }
});

function checkReadyToUpload() {
    if (isLoggedIn && isFileLoaded) {
        document.getElementById('part-name').disabled = false;
        document.getElementById('upload-btn').disabled = false;
    }
}

// ==========================================
// 3. 3D空間の構築
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight1.position.set(1, 2, 1).normalize();
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xaaccff, 0.6);
dirLight2.position.set(-1, -1, -1).normalize();
scene.add(dirLight2);

// 初期表示の立方体（投稿モードの時だけ出す）
let cube = null;
if (!isViewMode) {
    const geometry = new THREE.BoxGeometry(20, 20, 20);
    const material = new THREE.MeshStandardMaterial({ color: 0x00a0e9, roughness: 0.2, metalness: 0.5 });
    cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
}

const gltfLoader = new GLTFLoader();

// ==========================================
// 👑 プロ仕様：どんな3Dモデルもド真ん中に収める自動ピント調整
// ==========================================
function fitCameraToModel(modelScene) {
    // 1. モデル全体の正確な「大きさの箱（Bounding Box）」を計算する
    const box = new THREE.Box3().setFromObject(modelScene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    
    // 💡 重要：モデルの中心点が原点(0,0,0)からズレている場合、強制的に原点へ移動させる
    modelScene.position.sub(center); 

    // 2. モデルの縦・横・奥の「最大サイズ」を取得
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // 3. カメラの画角(FOV)から、モデルが綺麗に画面に収まる「最適な距離(Z軸)」を計算
    const fov = camera.fov * (Math.PI / 180);
    // 💡 1.5 という倍率（マージン）をかけることで、画面いっぱいにパツパツにならず、程よい余白を作ります
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5; 
    
    // 4. カメラのクリッピング（描画限界距離）をモデルのサイズに合わせて自動調整（巨大モデルのクリップ防止）
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    // 5. カメラを「少し斜め上」に配置して、最初から一番立体感が伝わるアングルにする
    // （真横からだと3D感が薄れるため、Y軸に少し高さを出すのが3Dビューアーの王道です）
    camera.position.set(maxDim * 0.3, maxDim * 0.5, cameraZ);
    
    // 6. マウスでの回転の中心（ターゲット）を完全に(0,0,0)に固定
    controls.target.set(0, 0, 0);
    
    // 7. カメラと操作パネル（OrbitControls）を最新状態に同期
    controls.maxDistance = maxDim * 10; // 無限に引きすぎて見失うのを防止
    controls.minDistance = maxDim * 0.1; // 近づきすぎてモデルを突き抜けるのを防止
    controls.update();
}

// ------------------------------------------
// 🚀 【新規】「見る専用モード」の時：Supabaseの倉庫から本物のファイルを全自動ロード！
// ------------------------------------------
if (isViewMode) {
    const supabaseUrl = window.location.hostname === 'localhost' 
        ? 'https://[あなたのSupabaseのプロジェクトID].supabase.co' 
        : 'https://[あなたのSupabaseのプロジェクトID].supabase.co'; 

    // 💡 【修正】読み込む時もコロン(:)をハイフン(-)に置き換えてからURLを作る
    const safeDid = didParam.replaceAll(':', '-');
    const toHex = (str) => {
        return Array.from(new TextEncoder().encode(str))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    };
    const safeName = toHex(nameParam);
    
    // 変換された英数字のファイル名を指定してダウンロード！
    const fileUrl = `${supabaseUrl}/storage/v1/object/public/models/${safeDid}_${safeName}.glb`;    // 倉庫からファイルを直接ダウンロードして画面に召喚！
    // 倉庫からファイルを直接ダウンロードして画面に召喚！
    gltfLoader.load(fileUrl, (gltf) => {
        currentMesh = gltf.scene;
        scene.add(currentMesh);
        fitCameraToModel(currentMesh);
    }, undefined, (error) => {
        console.error('3Dデータのロードに失敗しました:', error);
        alert('作品データの読み込みに失敗しました。URLが正しいか、またはデータが削除されている可能性があります。');
    });
}

// ------------------------------------------
// 投稿モードの時だけファイルのドロップを受け付ける
// ------------------------------------------
if (!isViewMode) {
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (!file || (!file.name.endsWith('.glb') && !file.name.endsWith('.gltf'))) return;

        if (cube) { scene.remove(cube); cube = null; }
        if (currentMesh) { scene.remove(currentMesh); }

        rawUploadedFile = file; // 💡 サーバーに送るために生データをキープ！

        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onload = function (event) {
            gltfLoader.parse(event.target.result, '', (gltf) => {
                currentMesh = gltf.scene;
                scene.add(currentMesh);
                fitCameraToModel(currentMesh);

                isFileLoaded = true;
                checkReadyToUpload();
            });
        };
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (cube) {
        cube.rotation.x += 0.003;
        cube.rotation.y += 0.003;
    }
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();