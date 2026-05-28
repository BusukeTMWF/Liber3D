import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { GLTFLoader } from 'three-stdlib';

let isLoggedIn = false;
let isFileLoaded = false;
let userDid = null;
let currentMesh = null;

// ==========================================
// 1. ログイン状態のチェック
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const did = urlParams.get('did');

if (did) {
    userDid = did;
    isLoggedIn = true;
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('profile-area').style.display = 'block';
    document.getElementById('upload-form').style.display = 'block';
    document.getElementById('welcome-msg').innerText = `✨ ログイン完了！\n(ID: ${did.substring(0, 15)}...)`;
    window.history.replaceState({}, document.title, "/");
}

// ==========================================
// 2. 投稿ボタンを押したときの処理（計測値を乗せないシンプル版）
// ==========================================
document.getElementById('upload-btn').addEventListener('click', async () => {
    const partName = document.getElementById('part-name').value;
    if (!partName) return;

    const uploadBtn = document.getElementById('upload-btn');
    try {
        uploadBtn.innerText = '投稿中...';
        uploadBtn.disabled = true;

        // 💡 収益化・拡散を見据えた王道テキスト：見せびらかしに特化！
        const postText = `【Liber3D】\n3D作品「${partName}」を登録しました！ブラウザでグリグリ動かして見られます！\n#Liber3D`;

        const response = await fetch('/api/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ did: userDid, text: postText })
        });

        const result = await response.json();
        if (result.success) {
            alert(`🎉「${partName}」をシェアしました！`);
            document.getElementById('part-name').value = '';
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
// 3. 3D空間の構築（巨大表示・映画風グラフィックス）
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // 💡 さらに深い漆黒にしてモデルを引き立てる

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 100); // 初期位置（後ほど自動調整されます）

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2; // 💡 少し明るくしてグラフィックのヌルテカ感をアップ
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// ライト配置（見せびらかし用のスタジオ照明）
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2); // メイン光を強く
dirLight1.position.set(1, 2, 1).normalize();
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0xaaccff, 0.6); // エッジを際立たせる青みがかった逆光
dirLight2.position.set(-1, -1, -1).normalize();
scene.add(dirLight2);

// 初期表示の立方体（最初から大きく表示）
const geometry = new THREE.BoxGeometry(20, 20, 20);
const material = new THREE.MeshStandardMaterial({ color: 0x00a0e9, roughness: 0.2, metalness: 0.5 });
let cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const gltfLoader = new GLTFLoader();

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || (!file.name.endsWith('.glb') && !file.name.endsWith('.gltf'))) return;

    if (cube) { scene.remove(cube); cube = null; }
    if (currentMesh) { scene.remove(currentMesh); }

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = function (event) {
        gltfLoader.parse(event.target.result, '', (gltf) => {
            currentMesh = gltf.scene;
            
            // 💡 【プロの技術】モデルを完全に中央へ配置
            const box = new THREE.Box3().setFromObject(currentMesh);
            const center = new THREE.Vector3();
            box.getCenter(center);
            currentMesh.position.sub(center);
            scene.add(currentMesh);

            // 💡 【王道ロジック】どんな大きさのモデルでも、画面いっぱいに最大化するカメラ調整
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
            
            cameraZ *= 1.4; // 💡 画面端に少しだけ綺麗な余白を作る倍率
            camera.position.set(0, maxDim * 0.2, cameraZ); // やや斜め上からの極上アングルに固定
            
            // カメラとマウス操作の基準点をパーツの中心にリセット
            controls.target.set(0, 0, 0);
            controls.update();

            isFileLoaded = true;
            checkReadyToUpload();
        });
    };
});

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