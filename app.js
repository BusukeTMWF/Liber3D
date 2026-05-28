import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { GLTFLoader } from 'three-stdlib';

let isLoggedIn = false;
let isFileLoaded = false;
let userDid = null;
let currentMesh = null;

// ==========================================
// 🧭 [新規] URLのパラメータを解析
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const didParam = urlParams.get('did');     // 投稿者のID
const nameParam = urlParams.get('name');   // 作品名
const isViewMode = didParam && nameParam;  // 両方あれば「見る専用モード」

// ==========================================
// 1. 画面の表示切り替え（UIコントロール）
// ==========================================
if (isViewMode) {
    // 💡 見る専用モード：すべてのフォームを隠し、タイトルだけを出す
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('profile-area').style.display = 'none';
    document.getElementById('upload-form').style.display = 'none';
    
    // 画面に「〇〇さんの作品」と表示（後ほどHTML側にも反映させます）
    const header = document.createElement('div');
    header.id = 'viewer-header';
    header.innerHTML = `<h1>🎨 ${nameParam}</h1><p>Created by: ${didParam.substring(0, 15)}...</p>`;
    document.body.appendChild(header);
} else {
    // 💡 従来の投稿モード
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
// 2. 投稿ボタンを押したときの処理（自動シェアURLの生成）
// ==========================================
document.getElementById('upload-btn').addEventListener('click', async () => {
    const partName = document.getElementById('part-name').value;
    if (!partName) return;

    const uploadBtn = document.getElementById('upload-btn');
    try {
        uploadBtn.innerText = '投稿中...';
        uploadBtn.disabled = true;

        // 💡 【超・王道】Blueskyのタイムラインに流す「専用ビューアーURL」を自動組み立て！
        const currentUrl = window.location.origin;
        const shareUrl = `${currentUrl}/?did=${userDid}&name=${encodeURIComponent(partName)}`;
        
        const postText = `【Liber3D】\n3D作品「${partName}」を登録しました！\nブラウザでグリグリ動かして見られます！👇\n${shareUrl}\n\n#Liber3D`;

        const response = await fetch('/api/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ did: userDid, text: postText })
        });

        const result = await response.json();
        if (result.success) {
            alert(`🎉「${partName}」をBlueskyにシェアしました！`);
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

// 初期表示の立方体（見る専用モードなら非表示にする）
const geometry = new THREE.BoxGeometry(20, 20, 20);
const material = new THREE.MeshStandardMaterial({ color: 0x00a0e9, roughness: 0.2, metalness: 0.5 });
let cube = new THREE.Mesh(geometry, material);

if (!isViewMode) {
    scene.add(cube);
} else {
    // 💡 [次回の布石] 見る専用モードの時は、ここにSupabaseから3Dデータを自動ロードする処理が入ります
    // 現段階では、確認用にダミーの球体を表示させておきます
    const sphereGeo = new THREE.SphereGeometry(15, 32, 32);
    const sphereMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.1, metalness: 0.8 });
    const dummyModel = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(dummyModel);
}

const gltfLoader = new GLTFLoader();

// 💡 投稿モードの時だけファイルのドロップを受け付ける（勝手に上書きされるのを防ぐ）
if (!isViewMode) {
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
                
                const box = new THREE.Box3().setFromObject(currentMesh);
                const center = new THREE.Vector3();
                box.getCenter(center);
                currentMesh.position.sub(center);
                scene.add(currentMesh);

                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = camera.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.4;
                
                camera.position.set(0, maxDim * 0.2, cameraZ);
                controls.target.set(0, 0, 0);
                controls.update();

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