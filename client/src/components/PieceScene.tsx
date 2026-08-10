import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * A real WebGL chess-piece cluster for the landing hero — glossy 3D pieces
 * (king, queen, knight, fallen pawn) lit from the upper left, matching the
 * product-shot look the design calls for. Pieces are lathe-turned solids
 * with a clearcoat physical material, soft blob shadows, and a gentle
 * staggered bob. The renderer is disposed on unmount; if WebGL context
 * creation fails the component renders nothing (the caller keeps the SVG
 * cluster as the no-WebGL fallback).
 */
export function PieceScene(): React.JSX.Element | null {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let raf = 0;
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

    // Soft radial blob shadow texture (one shared canvas texture).
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sctx = shadowCanvas.getContext('2d');
    if (sctx) {
      const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
      grad.addColorStop(0, 'rgba(2,6,23,0.55)');
      grad.addColorStop(0.6, 'rgba(2,6,23,0.25)');
      grad.addColorStop(1, 'rgba(2,6,23,0)');
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

    // ---- Piece profiles (lathe: [x, y] radii from the base up) ----------
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
    const knightHead = new THREE.Mesh(knightHeadGeo, whiteMat);
    knightHead.geometry.computeVertexNormals();

    // ---- Assemble the cluster -------------------------------------------
    const group = new THREE.Group();

    const king = lathe(KING, whiteMat);
    king.position.set(-0.55, 0, -0.25);
    // Cross finial on the king's head.
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), whiteMat);
    crossV.position.set(-0.55, 2.56, -0.25);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.07), whiteMat);
    crossH.position.set(-0.55, 2.47, -0.25);
    group.add(king, crossV, crossH);

    const queen = lathe(QUEEN, blackMat);
    queen.position.set(0.32, 0, 0.05);
    // Crown: small spheres on a ring at the head top.
    for (let i = 0; i < 5; i += 1) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), blackMat);
      const a = (i / 5) * Math.PI * 2;
      ball.position.set(0.32 + Math.cos(a) * 0.2, 2.3, 0.05 + Math.sin(a) * 0.2);
      group.add(ball);
    }
    group.add(queen);

    const knightBody = lathe(KNIGHT_COLUMN, whiteMat);
    knightBody.position.set(0.72, 0, -0.1);
    knightHead.position.x = 0.72;
    knightHead.position.z = -0.1;
    group.add(knightBody, knightHead);

    const pawn = lathe(PAWN, whiteMat);
    pawn.position.set(-0.05, 0.12, 0.62);
    pawn.rotation.z = -1.35; // fallen over, lying toward the viewer's right
    group.add(pawn);

    // Blob shadows under each standing piece + the fallen pawn.
    scene.add(addBlobShadow(-0.55, -0.25, 1.05, 0.85));
    scene.add(addBlobShadow(0.32, 0.05, 0.95, 0.8));
    scene.add(addBlobShadow(0.72, -0.1, 0.85, 0.7));
    scene.add(addBlobShadow(-0.05, 0.62, 0.85, 0.55));

    scene.add(group);

    // ---- Animation: staggered bob + gentle sway ------------------------
    const baseY = new Map<THREE.Object3D, number>();
    for (const piece of [king, queen, knightBody, pawn]) {
      baseY.set(piece, piece.position.y);
    }
    const phases = [0, 1.6, 3.2, 0.8]; // king, queen, knight, pawn

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
      const pieces = [king, queen, knightBody, pawn];
      for (let i = 0; i < pieces.length; i += 1) {
        const p = pieces[i]!;
        const y0 = baseY.get(p) ?? 0;
        p.position.y = y0 + Math.sin(t * 1.1 + phases[i]!) * 0.035;
      }
      // The knight's head rides the body's bob.
      knightHead.position.y =
        (baseY.get(knightBody) ?? 0) + Math.sin(t * 1.1 + phases[2]!) * 0.035;
      group.rotation.y = Math.sin(t * 0.45) * 0.08;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      pmrem.dispose();
      envTexture.dispose();
      shadowTexture.dispose();
      knightHeadGeo.dispose();
      for (const obj of group.children) {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      }
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
