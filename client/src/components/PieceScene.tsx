import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * A real WebGL chess-piece cluster for the landing hero. The pieces are a
 * real 3D model imported from the WebKit WebXR chess demo
 * (github.com/WebKit/WebKit → Websites/webkit.org/demos/webxr-chess), vendored
 * at /models/hero-chess.glb (king + queen + knight + pawn, stylized Staunton
 * set with vertex-colored white/black ceramic finish). They are lit from the
 * upper left with a glossy environment, soft blob shadows, and a gentle
 * staggered bob — matching the product-shot look the design calls for.
 *
 * If the model fails to load (network error, corrupt file), the component
 * falls back to the hand-turned procedural cluster so the hero never renders
 * empty. If WebGL context creation fails it renders nothing — the caller
 * gates on `supportsWebGL` and just shows the empty board backdrop.
 *
 * The renderer is disposed on unmount.
 */
export function PieceScene(): React.JSX.Element | null {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let raf = 0;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        // Keep the frame around after compositing so the canvas is
        // inspectable (screenshots/readback); negligible cost at this size.
        preserveDrawingBuffer: true,
      });
    } catch {
      setFailed(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(4.4, 2.7, 5.6);
    camera.lookAt(0, 0.85, 0);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    mount.appendChild(renderer.domElement);

    // Glossy reflections: a soft studio environment makes the clearcoat
    // read as real ceramic instead of flat plastic.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    // Upper-left key light, matching the reference's lighting direction.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb9c4ff, 0.35);
    fill.position.set(-6, 3, -4);
    scene.add(fill);

    // Soft radial blob shadow texture (one shared canvas texture). Neutral
    // black so the contact shadows read as plain darkness on the board, not a
    // blue/navy glow under the pieces.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d');
    if (sctx) {
      const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 64, 64);
    }
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);

    const addBlobShadow = (x: number, z: number, w: number, d: number): THREE.Mesh => {
      const geo = new THREE.PlaneGeometry(w, d);
      const mat = new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.012, z);
      return mesh;
    };

    // ---- The imported piece set -----------------------------------------
    // Layout in world units mirrors the old procedural cluster: king + queen
    // standing behind, knight off to the right, a fallen pawn in front.
    // Each piece is rescaled from its loaded size to the target height so
    // the cluster reads at the same scale regardless of model units.
    // X positions are spread so the pieces never touch: the GLB set is wider
    // than the old lathe pieces (king ≈ 0.39× its height, knight ≈ 0.53×),
    // so the cluster needs room — king far left, queen right of centre,
    // knight right, fallen pawn out front. The king + queen are the hero's
    // two lead pieces: kept taller than the rest and pushed apart (2.1 units
    // of x-separation plus a little z depth) so their silhouettes read as a
    // clear pair rather than a crowd.
    const LAYOUT: ReadonlyArray<{
      node: string;
      height: number;
      x: number;
      z: number;
      /** 0 = standing; nonzero tips the piece over (lying down). */
      rotateZ?: number;
      bobPhase: number;
    }> = [
      { node: 'king', height: 2.7, x: -1.65, z: -0.4, bobPhase: 0 },
      { node: 'queen', height: 2.5, x: 0.45, z: 0.05, bobPhase: 1.6 },
      { node: 'knight', height: 1.9, x: 1.45, z: -0.15, bobPhase: 3.2 },
      { node: 'pawn', height: 1.45, x: -0.35, z: 0.85, rotateZ: -1.35, bobPhase: 0.8 },
    ];

    let group: THREE.Group | null = null;
    const shadowMeshes: THREE.Mesh[] = [];

    /**
     * Normalise a loaded piece: scale so it stands `height` units tall with
     * its base on y=0 and its own origin at (0,0,0) (the caller then places
     * it in the cluster).
     */
    function placePiece(piece: THREE.Object3D, height: number): void {
      const box = new THREE.Box3().setFromObject(piece);
      const size = box.getSize(new THREE.Vector3());
      const s = height / size.y;
      piece.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(piece);
      piece.position.y -= box2.min.y;
      piece.position.x = 0;
      piece.position.z = 0;
    }

    function addClusterShadows(): void {
      const defs: ReadonlyArray<[number, number, number, number]> = [
        [-1.65, -0.4, 1.2, 0.95],
        [0.45, 0.05, 1.1, 0.9],
        [1.45, -0.15, 0.85, 0.7],
        [-0.35, 0.85, 0.85, 0.55],
      ];
      for (const [x, z, w, d] of defs) {
        const m = addBlobShadow(x, z, w, d);
        shadowMeshes.push(m);
        scene.add(m);
      }
    }

    /** Build the cluster from the imported GLB pieces. */
    function buildGltfCluster(gltf: { scene: THREE.Group }): void {
      group = new THREE.Group();
      for (const item of LAYOUT) {
        const src = gltf.scene.getObjectByName(item.node);
        if (!src) continue;
        const piece = src.clone(true);
        piece.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        placePiece(piece, item.height);
        piece.position.x = item.x;
        piece.position.z = item.z;
        if (item.rotateZ) {
          piece.rotation.z = item.rotateZ;
          // A 77° tip leaves the fallen pawn's head about a third of its
          // height off the ground — exactly the propped-up look we want.
          piece.position.y = 0.05;
        }
        group.add(piece);
      }
      scene.add(group);
      addClusterShadows();
      seedBobTargets();
    }

    // ---- The procedural fallback (pre-import hand-turned cluster) ---------
    const PAWN: ReadonlyArray<[number, number]> = [
      [0.3, 0], [0.32, 0.05], [0.3, 0.1], [0.21, 0.35], [0.18, 0.6],
      [0.16, 0.68], [0.24, 0.72], [0.24, 0.8], [0.19, 0.88],
      [0.27, 1.2], [0.28, 1.38], [0.2, 1.45], [0.16, 1.62], [0.17, 1.7],
    ];
    const KING: ReadonlyArray<[number, number]> = [
      [0.4, 0], [0.42, 0.05], [0.4, 0.12], [0.28, 0.55], [0.33, 1.0],
      [0.4, 1.35], [0.3, 1.55], [0.26, 1.62], [0.24, 1.68], [0.3, 1.72],
      [0.2, 1.8], [0.17, 2.0], [0.19, 2.25], [0.2, 2.35],
    ];
    const QUEEN: ReadonlyArray<[number, number]> = [
      [0.38, 0], [0.4, 0.05], [0.38, 0.12], [0.26, 0.55], [0.31, 1.0],
      [0.37, 1.3], [0.28, 1.5], [0.25, 1.58], [0.23, 1.64], [0.28, 1.68],
      [0.19, 1.76], [0.16, 1.95], [0.18, 2.15], [0.19, 2.25],
    ];
    const KNIGHT_COLUMN: ReadonlyArray<[number, number]> = [
      [0.36, 0], [0.38, 0.05], [0.36, 0.12], [0.25, 0.5], [0.24, 0.8],
      [0.26, 1.0], [0.25, 1.15],
    ];

    const whiteMat = new THREE.MeshPhysicalMaterial({
      color: 0xf0e9da,
      roughness: 0.32,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    const blackMat = new THREE.MeshPhysicalMaterial({
      color: 0x191a1f,
      roughness: 0.28,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });

    const lathe = (profile: ReadonlyArray<[number, number]>, mat: THREE.Material): THREE.Mesh => {
      const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const geo = new THREE.LatheGeometry(pts, 48);
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, mat);
    };

    // Knight head: an extruded side-profile of a horse head, facing left.
    const knightHeadShape = new THREE.Shape();
    knightHeadShape.moveTo(0, 0);
    knightHeadShape.bezierCurveTo(0.04, 0.14, 0.1, 0.3, 0.12, 0.42); // back of head
    knightHeadShape.lineTo(0.1, 0.5);
    knightHeadShape.lineTo(-0.03, 0.58); // ear tip
    knightHeadShape.lineTo(-0.09, 0.46); // ear base
    knightHeadShape.lineTo(-0.22, 0.4); // forehead
    knightHeadShape.bezierCurveTo(-0.3, 0.36, -0.32, 0.28, -0.28, 0.2); // nose
    knightHeadShape.lineTo(-0.24, 0.14); // muzzle
    knightHeadShape.bezierCurveTo(-0.14, 0.12, -0.06, 0.08, 0, 0); // jaw back to neck
    const knightHeadGeo = new THREE.ExtrudeGeometry(knightHeadShape, {
      depth: 0.26,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    });
    knightHeadGeo.translate(0, 1.15, 0); // sit on the column

    /**
     * Build the procedural cluster (fallback when the GLB can't load).
     * Lathe profiles are authored at fixed heights (king 2.35, queen 2.25),
     * so each piece is wrapped in a group and scaled to the LAYOUT height
     * the GLB path uses — keeps the fallback visually in sync with the
     * imported cluster.
     */
    function buildProceduralCluster(): void {
      group = new THREE.Group();

      const scaled = (
        profile: ReadonlyArray<[number, number]>,
        mat: THREE.Material,
        targetHeight: number,
        extra?: (g: THREE.Group) => void,
      ): THREE.Group => {
        const g = new THREE.Group();
        const mesh = lathe(profile, mat);
        g.add(mesh);
        const box = new THREE.Box3().setFromObject(g);
        const s = targetHeight / box.getSize(new THREE.Vector3()).y;
        g.scale.setScalar(s);
        if (extra) extra(g);
        return g;
      };

      // King (white): scaled to 2.7, cross finial rides along in the group.
      const kingG = scaled(KING, whiteMat, 2.7, (g) => {
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), whiteMat);
        crossV.position.set(0, 2.56, 0);
        const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.07), whiteMat);
        crossH.position.set(0, 2.47, 0);
        g.add(crossV, crossH);
      });
      kingG.name = 'king';
      kingG.position.set(-1.65, 0, -0.4);
      group.add(kingG);

      // Queen (black): scaled to 2.5, crown spheres ride along in the group.
      const queenG = scaled(QUEEN, blackMat, 2.5, (g) => {
        // Crown: small spheres on a ring at the head top.
        for (let i = 0; i < 5; i += 1) {
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), blackMat);
          const a = (i / 5) * Math.PI * 2;
          ball.position.set(Math.cos(a) * 0.2, 2.3, Math.sin(a) * 0.2);
          g.add(ball);
        }
      });
      queenG.name = 'queen';
      queenG.position.set(0.45, 0, 0.05);
      group.add(queenG);

      const knightBody = lathe(KNIGHT_COLUMN, whiteMat);
      knightBody.name = 'knight';
      knightBody.position.set(1.45, 0, -0.15);
      const head = new THREE.Mesh(knightHeadGeo, whiteMat);
      head.name = 'knight-head';
      head.position.set(1.45, 1.15, -0.15);
      group.add(knightBody, head);

      const pawn = lathe(PAWN, whiteMat);
      pawn.name = 'pawn';
      pawn.position.set(-0.35, 0.05, 0.85);
      pawn.rotation.z = -1.35; // fallen over, lying toward the viewer's right
      group.add(pawn);

      scene.add(group);
      addClusterShadows();
      seedBobTargets();
    }

    // Try the imported model first; fall back to the procedural cluster.
    const gltfUrl = `${import.meta.env.BASE_URL}models/hero-chess.glb`;
    new GLTFLoader().load(
      gltfUrl,
      (gltf) => {
        if (disposed) return;
        const missing = LAYOUT.filter((l) => !gltf.scene.getObjectByName(l.node));
        if (missing.length > 0) {
          buildProceduralCluster();
          return;
        }
        buildGltfCluster(gltf);
      },
      undefined,
      () => {
        if (!disposed) buildProceduralCluster();
      },
    );

    // ---- Animation: staggered bob + gentle sway ------------------------
    interface BobTarget {
      obj: THREE.Object3D;
      baseY: number;
      phase: number;
    }
    const bobTargets: BobTarget[] = [];

    function seedBobTargets(): void {
      bobTargets.length = 0;
      if (!group) return;
      for (const item of LAYOUT) {
        const obj = group.getObjectByName(item.node);
        if (!obj) continue;
        bobTargets.push({ obj, baseY: obj.position.y, phase: item.bobPhase });
        // The procedural knight's head rides the body's bob.
        if (item.node === 'knight') {
          const head = group.getObjectByName('knight-head');
          if (head) bobTargets.push({ obj: head, baseY: head.position.y, phase: item.bobPhase });
        }
      }
    }

    const start = performance.now();
    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight, false);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);
    onResize();

    const tick = (now: number) => {
      const t = (now - start) / 1000;
      if (group) {
        if (bobTargets.length > 0) {
          for (const { obj, baseY, phase } of bobTargets) {
            obj.position.y = baseY + Math.sin(t * 1.1 + phase) * 0.035;
          }
        }
        group.rotation.y = Math.sin(t * 0.45) * 0.08;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      pmrem.dispose();
      envTexture.dispose();
      shadowTexture.dispose();
      knightHeadGeo.dispose();
      for (const obj of scene.children) {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            for (const m of obj.material) m.dispose();
          } else {
            (obj.material as THREE.Material).dispose();
          }
        }
      }
      // Dispose textures owned by the imported material.
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            const tex = (m as THREE.MeshStandardMaterial).map;
            if (tex) tex.dispose();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (failed) return null;

  return (
    <div
      ref={mountRef}
      className="relative mx-auto h-[440px] w-full max-w-[560px] select-none sm:h-[520px]"
      aria-hidden
    />
  );
}
