import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { canonicalizeGLBBones } from "@three-ws/retarget";
import { inspectBones, renderBoneReport } from "./bone-inspector.js";

const canvas = document.querySelector("#viewer");
const status = document.querySelector("#status");

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090b10);

const camera = new THREE.PerspectiveCamera(
    35,
    window.innerWidth / window.innerHeight,
    0.01,
    100
);
camera.position.set(0, 1.2, 4);

const ambient = new THREE.HemisphereLight(0xdde8ff, 0x20232b, 2.2);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fa8ff, 1.0);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({
        color: 0x151922,
        roughness: 0.9,
        metalness: 0.0,
    })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// ─── ЛОКАЛЬНЫЙ ASSET ЧЕРЕЗ VITE BASE_URL ───
const MODEL_URL = `${import.meta.env.BASE_URL}models/Xbot.glb`;

const STAGE_TIMEOUT_MS = 10000;
let model = null;

function setStatus(message) {
    status.textContent = message;
    console.log(`[AstraWay] ${message}`);
}

function withTimeout(promise, label, timeoutMs = STAGE_TIMEOUT_MS) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label}: таймаут ${timeoutMs / 1000} сек`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer !== null) clearTimeout(timer);
    });
}

function frameModel(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance =
        maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));

    camera.position.set(
        center.x,
        center.y + maxSize * 0.08,
        center.z + distance * 1.25
    );
    camera.lookAt(center.x, center.y, center.z);
    ground.position.y = box.min.y;
}

async function loadModel() {
    try {
        setStatus("1/7 — Начинаем запрос X Bot…");
        console.log("[AstraWay] MODEL_URL:", MODEL_URL);

        const response = await withTimeout(
            fetch(MODEL_URL, { cache: "no-store", mode: "cors" }),
            "Сетевой запрос X Bot"
        );

        setStatus(`2/7 — Ответ сервера: HTTP ${response.status}`);

        if (!response.ok) {
            throw new Error(`X Bot: HTTP ${response.status} ${response.statusText}`);
        }

        const contentLength = response.headers.get("content-length");
        const contentType = response.headers.get("content-type");

        console.log("[AstraWay] X Bot response:", {
            status: response.status,
            contentType,
            contentLength,
        });

        setStatus(
            `3/7 — Получаем GLB…${
                contentLength
                    ? ` ${(Number(contentLength) / 1024 / 1024).toFixed(2)} MB`
                    : ""
            }`
        );

        const buffer = await withTimeout(response.arrayBuffer(), "Чтение GLB");

        if (buffer.byteLength === 0) {
            throw new Error("X Bot: получен пустой GLB");
        }

        console.log(`[AstraWay] GLB bytes: ${buffer.byteLength}`);
        setStatus(
            `4/7 — GLB получен: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`
        );

        setStatus("5/7 — Канонизируем скелет…");

        const canonicalBuffer = await withTimeout(
            canonicalizeGLBBones(buffer),
            "Канонизация скелета"
        );

        if (!canonicalBuffer || canonicalBuffer.byteLength === 0) {
            throw new Error("Канонизация вернула пустой GLB");
        }

        console.log(`[AstraWay] Canonical GLB bytes: ${canonicalBuffer.byteLength}`);

        setStatus("6/7 — Парсим GLB через GLTFLoader…");

        const gltf = await withTimeout(
            loader.parseAsync(canonicalBuffer, ""),
            "GLTFLoader.parseAsync"
        );

        if (!gltf || !gltf.scene) {
            throw new Error("GLTFLoader не вернул scene");
        }

        model = gltf.scene;
        scene.add(model);
        frameModel(model);

        setStatus("7/7 — Проверяем скелет…");

        const report = inspectBones(model);
        renderBoneReport(report);

        console.log("[AstraWay] Skeleton report:", report);

        if (report.canonicalMissing.length > 0) {
            status.textContent = `❌ Canonical joints: ${report.canonicalFound}/${report.canonicalTotal}`;
            console.error(
                "[AstraWay] Missing canonical joints:",
                report.canonicalMissing
            );
            return;
        }

        status.textContent = `GREEN — ${report.canonicalFound}/${report.canonicalTotal} canonical joints | logical: ${report.logicalFound}/${report.logicalTotal}`;
        console.log("[AstraWay] Character Lab GREEN", report);
    } catch (error) {
        console.error("[AstraWay] Character Lab ERROR", error);
        const message = error?.message || "Неизвестная ошибка";
        status.textContent = `❌ ${message}`;
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (model) {
        model.rotation.y += 0.0025;
    }
    renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

loadModel();
animate();
