'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Animated 3D backdrop: film reels and film strips drifting through a field of
// particles. The camera follows the mouse, the scene scrolls with the page, and
// everything spins up for a moment whenever `pulse` changes (after a search).

interface BackdropProps {
    theme: 'light' | 'dark';
    pulse: number;
}

interface SceneApi {
    applyTheme: (theme: 'light' | 'dark') => void;
    pulse: () => void;
}

const PALETTE = {
    dark: { reel: '#94a3b8', reelOpacity: 0.9, metalness: 0.7, strip: 0.32, particle: 0.9, glowA: '#818cf8', glowB: '#fbbf24' },
    light: { reel: '#c7d2fe', reelOpacity: 0.55, metalness: 0.25, strip: 0.16, particle: 0.55, glowA: '#4f46e5', glowB: '#f59e0b' },
};

// Soft round dot, so particles aren't drawn as squares
function makeDotTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

// A strip of film: sprocket holes along both edges and tinted frames between them
function makeFilmTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, 1024, 128);

    ctx.fillStyle = '#e2e8f0';
    for (let x = 8; x < 1024; x += 32) {
        ctx.beginPath();
        ctx.roundRect(x, 8, 16, 14, 3);
        ctx.roundRect(x, 106, 16, 14, 3);
        ctx.fill();
    }

    const hues = [245, 280, 38, 200, 330, 160, 20, 260];
    for (let i = 0; i < 8; i++) {
        const x = i * 128 + 10;
        const gradient = ctx.createLinearGradient(x, 30, x + 108, 98);
        gradient.addColorStop(0, `hsla(${hues[i]}, 80%, 65%, 0.95)`);
        gradient.addColorStop(1, `hsla(${hues[(i + 3) % 8]}, 80%, 45%, 0.95)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, 30, 108, 68);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.set(2, 1);
    return texture;
}

function makeReel(material: THREE.Material, holeMaterial: THREE.Material): THREE.Group {
    const reel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.07, 12, 64), material);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.05, 64), material);
    disc.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 32), material);
    hub.rotation.x = Math.PI / 2;
    reel.add(rim, disc, hub);

    // The five cut-outs of a film reel, as dark discs sitting just proud of the face
    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 32), holeMaterial);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(Math.cos(angle) * 0.56, Math.sin(angle) * 0.56, 0);
        reel.add(hole);
    }
    return reel;
}

function createScene(canvas: HTMLCanvasElement, initialTheme: 'light' | 'dark'): (SceneApi & { dispose: () => void }) | null {
    let renderer: THREE.WebGLRenderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
        // No WebGL (old device, disabled GPU): the page works fine without the backdrop
        return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 10);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);
    const glowA = new THREE.PointLight(0x818cf8, 30, 30);
    glowA.position.set(-6, 3, 4);
    const glowB = new THREE.PointLight(0xfbbf24, 20, 30);
    glowB.position.set(6, -4, 4);
    scene.add(glowA, glowB);

    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(item: T) => {
        disposables.push(item);
        return item;
    };

    // Particles
    const isSmallScreen = window.innerWidth < 640;
    const particleCount = isSmallScreen ? 350 : 900;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const tints = [new THREE.Color('#818cf8'), new THREE.Color('#fbbf24'), new THREE.Color('#f472b6'), new THREE.Color('#e2e8f0')];
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 30;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 24;
        positions[i * 3 + 2] = -Math.random() * 16 + 2;
        const tint = tints[i % tints.length];
        colors.set([tint.r, tint.g, tint.b], i * 3);
    }
    const particleGeometry = track(new THREE.BufferGeometry());
    particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const particleMaterial = track(
        new THREE.PointsMaterial({
            size: 0.14,
            map: track(makeDotTexture()),
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }),
    );
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // Film reels, kept towards the edges so they don't sit behind the text
    const reelMaterial = track(new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.7, roughness: 0.3, transparent: true }));
    const holeMaterial = track(new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.2, roughness: 0.8, transparent: true }));
    const reelLayout = [
        { x: -6.5, y: 3.2, z: -2, s: 1.3 },
        { x: 6.8, y: 2.4, z: -3, s: 1.0 },
        { x: -7.5, y: -3.6, z: -5, s: 1.1 },
        { x: 7.2, y: -3.8, z: -1, s: 0.8 },
        { x: 11, y: 6.5, z: -9, s: 1.4 },
        { x: -11, y: -1, z: -10, s: 1.0 },
    ];
    const reels = reelLayout.map(({ x, y, z, s }, i) => {
        const reel = makeReel(reelMaterial, holeMaterial);
        reel.position.set(x, y, z);
        reel.scale.setScalar(s);
        reel.rotation.set(0.3 * (i % 2 ? 1 : -1), 0.4 * (i % 3 ? 1 : -1), 0);
        reel.userData = { baseX: x, baseY: y, speed: 0.25 + (i % 3) * 0.12, direction: i % 2 ? 1 : -1, phase: i * 1.3 };
        scene.add(reel);
        return reel;
    });
    reels.forEach(reel => reel.traverse(obj => obj instanceof THREE.Mesh && track(obj.geometry)));

    // Film strips waving across the scene
    const filmTexture = track(makeFilmTexture());
    const stripMaterial = track(
        new THREE.MeshBasicMaterial({ map: filmTexture, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    const strips = [
        { y: 4.6, z: -6, tilt: -0.12 },
        { y: -1.2, z: -9, tilt: 0.08 },
        { y: -5.4, z: -4, tilt: -0.05 },
    ].map(({ y, z, tilt }, i) => {
        const geometry = track(new THREE.PlaneGeometry(26, 1.1, 80, 1));
        const strip = new THREE.Mesh(geometry, stripMaterial);
        strip.position.set(0, y, z);
        strip.rotation.z = tilt;
        strip.userData = { phase: i * 2, base: Float32Array.from(geometry.attributes.position.array) };
        scene.add(strip);
        return strip;
    });

    function applyTheme(theme: 'light' | 'dark') {
        const palette = PALETTE[theme];
        reelMaterial.color.set(palette.reel);
        reelMaterial.opacity = palette.reelOpacity;
        reelMaterial.metalness = palette.metalness;
        holeMaterial.opacity = palette.reelOpacity;
        stripMaterial.opacity = palette.strip;
        particleMaterial.opacity = palette.particle;
        // Additive blending washes out on a light background
        particleMaterial.blending = theme === 'dark' ? THREE.AdditiveBlending : THREE.NormalBlending;
        particleMaterial.needsUpdate = true;
        glowA.color.set(palette.glowA);
        glowB.color.set(palette.glowB);
    }
    applyTheme(initialTheme);

    // Interaction state
    const mouse = { x: 0, y: 0 };
    let lastMouse = { x: 0, y: 0 };
    let spinBoost = 0;
    let scrollY = window.scrollY;

    function resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        // On narrow screens pull the reels towards the edges, where they peek in
        // from the sides instead of sitting behind the text
        const spread = Math.min(Math.max(camera.aspect / 1.6, 0.5), 1);
        for (const reel of reels) reel.position.x = reel.userData.baseX * spread;
    }
    resize();

    const onPointerMove = (e: PointerEvent) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onScroll = () => {
        scrollY = window.scrollY;
    };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let running = false;
    let last = performance.now();
    let elapsed = 0;

    function render(now: number) {
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        elapsed += dt;

        // Moving the mouse quickly spins the reels faster; the boost decays over time
        const mouseSpeed = Math.hypot(mouse.x - lastMouse.x, mouse.y - lastMouse.y) / Math.max(dt, 0.001);
        lastMouse = { ...mouse };
        spinBoost = Math.min(spinBoost + mouseSpeed * 0.02, 12);
        spinBoost *= Math.pow(0.25, dt);

        camera.position.x += (mouse.x * 1.2 - camera.position.x) * Math.min(dt * 2.5, 1);
        camera.position.y += (mouse.y * 0.8 - scrollY * 0.004 - camera.position.y) * Math.min(dt * 2.5, 1);
        camera.lookAt(0, -scrollY * 0.004, -4);

        for (const reel of reels) {
            const { baseY, speed, direction, phase } = reel.userData;
            reel.rotation.z += direction * (speed + spinBoost * 0.3) * dt;
            reel.position.y = baseY + Math.sin(elapsed * 0.5 + phase) * 0.35;
        }

        for (const strip of strips) {
            const { phase, base } = strip.userData;
            const position = strip.geometry.attributes.position as THREE.BufferAttribute;
            for (let i = 0; i < position.count; i++) {
                const x = base[i * 3];
                position.setZ(i, Math.sin(x * 0.35 + elapsed * 0.8 + phase) * 0.6);
            }
            position.needsUpdate = true;
        }
        // Frames run along the strips, faster while the reels are spinning up
        filmTexture.offset.x += (0.03 + spinBoost * 0.01) * dt;

        particles.rotation.y = elapsed * 0.02 + mouse.x * 0.05;
        particles.rotation.x = mouse.y * 0.03;
        particleMaterial.size = 0.14 + Math.min(spinBoost, 6) * 0.01;

        renderer.render(scene, camera);
    }

    function loop(now: number) {
        render(now);
        frame = requestAnimationFrame(loop);
    }

    function start() {
        if (running || reducedMotion.matches || document.hidden) return;
        running = true;
        last = performance.now();
        frame = requestAnimationFrame(loop);
    }

    function stop() {
        running = false;
        cancelAnimationFrame(frame);
    }

    // With reduced motion, draw a single still frame and redraw only when needed
    const renderStill = () => render(performance.now());

    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => {
        resize();
        if (!running) renderStill();
    };
    const onMotionChange = () => {
        if (reducedMotion.matches) {
            stop();
            renderStill();
        } else {
            start();
        }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', onMotionChange);

    renderStill();
    start();

    return {
        applyTheme(theme) {
            applyTheme(theme);
            if (!running) renderStill();
        },
        pulse() {
            spinBoost = 12;
        },
        dispose() {
            stop();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
            document.removeEventListener('visibilitychange', onVisibility);
            reducedMotion.removeEventListener('change', onMotionChange);
            disposables.forEach(d => d.dispose());
            renderer.dispose();
        },
    };
}

export default function Backdrop({ theme, pulse }: BackdropProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<(SceneApi & { dispose: () => void }) | null>(null);
    const themeRef = useRef(theme);

    useEffect(() => {
        if (!canvasRef.current) return;
        const api = createScene(canvasRef.current, themeRef.current);
        sceneRef.current = api;
        return () => {
            api?.dispose();
            sceneRef.current = null;
        };
    }, []);

    useEffect(() => {
        themeRef.current = theme;
        sceneRef.current?.applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        if (pulse > 0) sceneRef.current?.pulse();
    }, [pulse]);

    return <canvas ref={canvasRef} className="backdrop-canvas" aria-hidden="true" />;
}
