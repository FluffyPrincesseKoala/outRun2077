import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';

const scene = new THREE.Scene();
const bgColor = 0x050015;
scene.background = new THREE.Color(bgColor);

// THINNER FOG for long distance visibility
scene.fog = new THREE.FogExp2(bgColor, 0.00002); 

// INCREASED FAR PLANE
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 100000); 
camera.position.set(0, 150, 2000); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const speedo = document.createElement('div');
speedo.style = `position:fixed; bottom:40px; right:40px; color:#00ffff; font-family:monospace; font-size:32px; text-shadow:0 0 10px #00ffff; z-index:100;`;
document.body.appendChild(speedo);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const carLight = new THREE.PointLight(0x00ffff, 2.5, 5000); 
carLight.position.set(0, 500, 700);
scene.add(carLight);

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
loader.setDRACOLoader(dracoLoader);

const playerGroup = new THREE.Group();
playerGroup.position.set(0, 5, 700); 
scene.add(playerGroup);

loader.load('car.glb', (gltf) => {
    const model = gltf.scene;
    model.traverse((n) => { if (n.name === 'Circle005_50') n.visible = false; });
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z); 
    model.scale.set(180, 180, 180); 
    model.rotation.y = Math.PI; 
    playerGroup.add(model);
});

// --- Constants (EXTREME DRAW DISTANCE) ---
const SEG_L = 400, ROAD_W = 8000, DRAW_D = 1000, CAR_W_REF = 250; 
const ROAD_LIMIT = (ROAD_W / 2) - (CAR_W_REF / 2) - 100;
const OFFSET_BACK = 5, MAX_SPEED = 420;
const LANE_COUNT = 7;

const segments = [];
let difficulty = 1.0;

function addRoadChunk(len, curve) {
    for (let i = 0; i < len; i++) {
        let p = 1;
        if (i < 50) p = i / 50;           
        if (i > len - 50) p = (len - i) / 50; 
        segments.push({ curve: curve * p, color: (Math.floor(segments.length / 3) % 2) });
    }
}

function generateTrack() {
    while (segments.length < 20000) { // Larger buffer for longer draw
        const type = Math.random();
        const len = 200 + Math.floor(Math.random() * 300);
        if (type < 0.3) addRoadChunk(len, 0);
        else {
            const curveDirection = Math.random() > 0.5 ? 1 : -1;
            const curveIntensity = (2.0 + Math.random() * 3.0) * difficulty;
            addRoadChunk(len, curveDirection * curveIntensity);
            difficulty += 0.01;
        }
    }
}

addRoadChunk(500, 0);
generateTrack();

const roadMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(ROAD_W, SEG_L),
    new THREE.MeshStandardMaterial({ roughness: 0.1, metalness: 0.5 }),
    DRAW_D
);
scene.add(roadMesh);

const poleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(15, 15, 1200, 8),
    new THREE.MeshBasicMaterial({ color: 0x00ffff }),
    DRAW_D * 2
);
scene.add(poleMesh);

const laneMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(25, 250),
    new THREE.MeshBasicMaterial({ color: 0x00ffff }),
    DRAW_D * LANE_COUNT
);
scene.add(laneMesh);

let pos = 0, playerX = 0, speed = 0;
let carRotationY = 0; 
const keys = {};

let shakeAmount = 0;

function animate() {
    requestAnimationFrame(animate);

    const playerIdx = Math.floor(pos / SEG_L);
    if (playerIdx > segments.length - 5000) generateTrack();
    const currentCurve = segments[playerIdx % segments.length].curve;

    // 1. Physics
    if (keys['arrowup']) {
        const accel = 6 * (1 - (speed / MAX_SPEED));
        speed += Math.max(accel, 0.1); 
    } else if (keys['arrowdown']) {
        speed = Math.max(speed - 15, 0);
    } else {
        speed *= 0.99; 
    }

    let lateralInput = 0;
    let targetRotation = 0;
    if (speed > 10) { 
        if (keys['arrowleft']) { lateralInput = -1; targetRotation = 0.3; }
        if (keys['arrowright']) { lateralInput = 1; targetRotation = -0.3; }
    }

    // Centrifugal Glide
    const roadPush = -currentCurve * (speed / 200); 
    const playerPull = lateralInput * (speed / 12);
    playerX += (roadPush + playerPull);

    if (Math.abs(playerX) >= ROAD_LIMIT) {
        speed *= 0.98;
        playerX = THREE.MathUtils.clamp(playerX, -ROAD_LIMIT, ROAD_LIMIT);
    }

    speed = Math.min(speed, MAX_SPEED);
    speedo.innerHTML = `${Math.floor(speed).toString().padStart(3, '0')} KM/H`;
    pos += speed;

    // --- REFINED ADRENALINE ---
    
    // Subtle Zoom: Max FOV of 85 for a cleaner look
    const targetFOV = 60 + (speed / MAX_SPEED) * 25;
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.05);
    camera.updateProjectionMatrix();

    // Subtle Shake: Only starts at 350 KM/H and very light
    shakeAmount = 0;
    if (speed > 350) {
        shakeAmount = ((speed - 350) / (MAX_SPEED - 350)) * 4;
    }
    const shakeX = (Math.random() - 0.5) * shakeAmount;
    const shakeY = (Math.random() - 0.5) * shakeAmount;

    // 2. Render Calculation
    const startIdx = Math.floor(pos / SEG_L) - OFFSET_BACK;
    const offsetZ = pos % SEG_L;
    let dx = 0, currX = 0;
    
    for (let j = 0; j < OFFSET_BACK; j++) {
        const idxRaw = startIdx + j;
        const idx = (idxRaw < 0 ? segments.length + (idxRaw % segments.length) : idxRaw) % segments.length;
        dx += segments[idx].curve;
        currX += dx;
    }

    const dummy = new THREE.Object3D();
    for (let n = 0; n < DRAW_D; n++) {
        const idxRaw = startIdx + n;
        const idx = (idxRaw < 0 ? segments.length + (idxRaw % segments.length) : idxRaw) % segments.length;
        const seg = segments[idx];
        const relativeZ = -((n - OFFSET_BACK) * SEG_L - offsetZ);
        const segmentX = currX - playerX;

        dummy.position.set(segmentX, 0, relativeZ); 
        dummy.rotation.x = -Math.PI / 2;
        dummy.updateMatrix();
        roadMesh.setMatrixAt(n, dummy.matrix);
        roadMesh.setColorAt(n, seg.color ? new THREE.Color(0x080808) : new THREE.Color(0x101010));

        for(let l = 0; l < LANE_COUNT; l++) {
            const lanePosX = (l + 1) * (ROAD_W / (LANE_COUNT + 1)) - (ROAD_W / 2);
            dummy.position.set(segmentX + lanePosX, 5, relativeZ);
            dummy.updateMatrix();
            laneMesh.setMatrixAt(n * LANE_COUNT + l, dummy.matrix);
        }

        if (idx % 10 === 0) {
            dummy.rotation.x = 0;
            dummy.position.set(segmentX - ROAD_W/2 - 200, 300, relativeZ);
            dummy.updateMatrix();
            poleMesh.setMatrixAt(n * 2, dummy.matrix);
            dummy.position.set(segmentX + ROAD_W/2 + 200, 300, relativeZ);
            dummy.updateMatrix();
            poleMesh.setMatrixAt(n * 2 + 1, dummy.matrix);
        } else {
            dummy.position.set(0, -50000, 0); 
            dummy.updateMatrix();
            poleMesh.setMatrixAt(n * 2, dummy.matrix);
            poleMesh.setMatrixAt(n * 2 + 1, dummy.matrix);
        }
        currX += dx; dx += seg.curve;
    }
    
    roadMesh.instanceMatrix.needsUpdate = true;
    roadMesh.instanceColor.needsUpdate = true;
    poleMesh.instanceMatrix.needsUpdate = true;
    laneMesh.instanceMatrix.needsUpdate = true;

    // Visual Updates
    carRotationY = THREE.MathUtils.lerp(carRotationY, targetRotation, 0.1);
    playerGroup.rotation.y = carRotationY;
    playerGroup.rotation.z = THREE.MathUtils.lerp(playerGroup.rotation.z, -targetRotation * 0.1, 0.1);

    // Camera Positioning
    camera.position.x = shakeX;
    camera.position.y = 150 + shakeY;
    camera.lookAt(0, 100, -50000); 
    
    renderer.render(scene, camera);
}

window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
animate();