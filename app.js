import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

let isLoggedIn = false;
let isFileLoaded = false;
let userDid = null;

// ==========================================
// 1. ログイン状態のチェック（URLに鍵があるか？）
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

// 💡 ログインボタンの処理は、HTMLのform機能に任せるため削除しました！

// ==========================================
// 2. 投稿ボタンを押したときの処理（サーバーへ依頼）
// ==========================================
document.getElementById('upload-btn').addEventListener('click', async () => {
    const partName = document.getElementById('part-name').value;
    if (!partName) return;

    const uploadBtn = document.getElementById('upload-btn');
    try {
        uploadBtn.innerText = '投稿中...';
        uploadBtn.disabled = true;

        const postText = `【Liber3D】\n3Dプリントパーツ「${partName}」をアプリパスワードなしで登録しました！ #Liber3D`;

        const response = await fetch('/api/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ did: userDid, text: postText })
        });

        const result = await response.json();
        
        if (result.success) {
            alert(`🎉「${partName}」の投稿に成功しました！Blueskyを確認してください。`);
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
// 3. 3D空間の構築とSTL読み込み＆自動計測
// ==========================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 50, 100);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(20, 40, 30);
scene.add(dirLight);

const geometry = new THREE.BoxGeometry(10, 10, 10);
const material = new THREE.MeshStandardMaterial({ color: 0x00a0e9, roughness: 0.4 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const loader = new STLLoader();
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.stl')) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = function (event) {
        const contents = event.target.result;
        const geometry = loader.parse(contents);
        const material = new THREE.MeshStandardMaterial({ color: 0x90caf9, roughness: 0.5, metalness: 0.2 });
        const mesh = new THREE.Mesh(geometry, material);
        
        scene.remove(cube);
        
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        
        const sizeX = (box.max.x - box.min.x).toFixed(1);
        const sizeY = (box.max.y - box.min.y).toFixed(1);
        const sizeZ = (box.max.z - box.min.z).toFixed(1);

        document.getElementById('measure-area').style.display = 'block';
        document.getElementById('size-x').innerText = `横幅 (X): ${sizeX} mm`;
        document.getElementById('size-y').innerText = `奥行 (Y): ${sizeY} mm`;
        document.getElementById('size-z').innerText = `高さ (Z): ${sizeZ} mm`;

        const center = new THREE.Vector3();
        box.getCenter(center);
        mesh.position.sub(center);
        scene.add(mesh);

        isFileLoaded = true;
        checkReadyToUpload();
        if (cube) cube.material.color.setHex(0xff6600);
    };
});

function animate() {
    requestAnimationFrame(animate);
    if(cube) {
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