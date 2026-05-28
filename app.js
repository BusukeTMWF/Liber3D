import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { STLLoader } from 'three-stdlib';
import { GLTFLoader } from 'three-stdlib'; // 💡 新しい相棒：GLTF読み込みプログラマー

let isLoggedIn = false;
let isFileLoaded = false;
let userDid = null;
let measuredSize = { x: "0.0", y: "0.0", z: "0.0" };
let currentMesh = null; // 💡 画面上の3Dモデルを管理する変数

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
// 2. 投稿ボタンを押したときの処理
// ==========================================
document.getElementById('upload-btn').addEventListener('click', async () => {
    const partName = document.getElementById('part-name').value;
    if (!partName) return;

    const uploadBtn = document.getElementById('upload-btn');
    try {
        uploadBtn.innerText = '投稿中...';
        uploadBtn.disabled = true;

        const postText = `【Liber3D】\n3Dパーツ「${partName}」を登録しました！\n\n📐 サイズ:\n・横(X): ${measuredSize.x} mm\n・奥(Y): ${measuredSize.y} mm\n・高(Z): ${measuredSize.z} mm\n\n#Liber3D`;

        const response = await fetch('/api/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ did: userDid, text: postText })
        });

        const result = await response.json();
        if (result.success) {
            alert(`🎉「${partName}」のシェアに成功しました！`);
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
// 3. 3D空間の構築（グラフィカル強化版）
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a); // 💡 背景を高級感のあるダークグレーに

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 50, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // 💡 色合いを映画のように美しくする設定
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 💡 質感をリアルに見せるための環境光と強力なライトの追加
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight1.position.set(50, 100, 50);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x90caf9, 0.4); // 💡 反対側からうっすら青い光を当ててサイバー感を演出
dirLight2.position.set(-50, -50, -50);
scene.add(dirLight2);

// 初期表示用の立方体
const geometry = new THREE.BoxGeometry(10, 10, 10);
const material = new THREE.MeshStandardMaterial({ color: 0x00a0e9, roughness: 0.4 });
let cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const stlLoader = new STLLoader();
const gltfLoader = new GLTFLoader(); // 💡 インスタンス化

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    
    // 💡 既存のモデルを画面から綺麗に消去する処理
    if (cube) { scene.remove(cube); cube = null; }
    if (currentMesh) { scene.remove(currentMesh); }

    const reader = new FileReader();
    
    // ------------------------------------------
    // Aパターン：GLTF / GLBファイルの場合 (.glb / .gltf)
    // ------------------------------------------
    if (fileName.endsWith('.glb') || fileName.endsWith('.gltf')) {
        reader.readAsArrayBuffer(file);
        reader.onload = function (event) {
            gltfLoader.parse(event.target.result, '', (gltf) => {
                currentMesh = gltf.scene;
                
                // モデル全体のサイズを測る
                const box = new THREE.Box3().setFromObject(currentMesh);
                displaySize(box);

                // 中央配置
                const center = new THREE.Vector3();
                box.getCenter(center);
                currentMesh.position.sub(center);

                scene.add(currentMesh);
                isFileLoaded = true;
                checkReadyToUpload();
            });
        };
    } 
    // ------------------------------------------
    // Bパターン：従来のSTLファイルの場合 (.stl)
    // ------------------------------------------
    else if (fileName.endsWith('.stl')) {
        reader.readAsArrayBuffer(file);
        reader.onload = function (event) {
            const geometry = stlLoader.parse(event.target.result);
            const material = new THREE.MeshStandardMaterial({ color: 0x90caf9, roughness: 0.5, metalness: 0.2 });
            currentMesh = new THREE.Mesh(geometry, material);
            
            geometry.computeBoundingBox();
            displaySize(geometry.boundingBox);

            const center = new THREE.Vector3();
            geometry.boundingBox.getCenter(center);
            currentMesh.position.sub(center);

            scene.add(currentMesh);
            isFileLoaded = true;
            checkReadyToUpload();
        };
    }
});

// サイズ計測＆画面表示の共通関数
function displaySize(box) {
    const sizeX = (box.max.x - box.min.x).toFixed(1);
    const sizeY = (box.max.y - box.min.y).toFixed(1);
    const sizeZ = (box.max.z - box.min.z).toFixed(1);

    measuredSize = { x: sizeX, y: sizeY, z: sizeZ };

    document.getElementById('measure-area').style.display = 'block';
    document.getElementById('size-x').innerText = `横幅 (X): ${sizeX} mm`;
    document.getElementById('size-y').innerText = `奥行 (Y): ${sizeY} mm`;
    document.getElementById('size-z').innerText = `高さ (Z): ${sizeZ} mm`;
}

function animate() {
    requestAnimationFrame(animate);
    if (cube) {
        cube.rotation.x += 0.005;
        cube.rotation.y += 0.005;
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