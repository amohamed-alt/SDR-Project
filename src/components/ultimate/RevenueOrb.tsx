"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

function OrbMesh() {
  const mesh = useRef<THREE.Mesh>(null);
  const wire = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (mesh.current) {
      mesh.current.rotation.x += delta * 0.12;
      mesh.current.rotation.y += delta * 0.18;
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.4) * 0.025;
      mesh.current.scale.setScalar(pulse);
    }
    if (wire.current) {
      wire.current.rotation.x -= delta * 0.08;
      wire.current.rotation.y += delta * 0.11;
    }
  });

  return (
    <group>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1.38, 5]}/>
        <meshStandardMaterial color="#31cf8b" roughness={0.24} metalness={0.5} emissive="#0b6b4a" emissiveIntensity={0.28}/>
      </mesh>
      <mesh ref={wire} scale={1.08}>
        <icosahedronGeometry args={[1.4, 2]}/>
        <meshBasicMaterial color="#b9ffe0" wireframe transparent opacity={0.2}/>
      </mesh>
      <mesh scale={0.6}>
        <sphereGeometry args={[1, 32, 32]}/>
        <meshBasicMaterial color="#d8ffed" transparent opacity={0.16}/>
      </mesh>
    </group>
  );
}

export function RevenueOrb() {
  return (
    <div className="h-full min-h-[250px] w-full" aria-label="Interactive 3D revenue intelligence visualization">
      <Canvas camera={{ position: [0, 0, 4.1], fov: 48 }} dpr={[1, 1.6]}>
        <ambientLight intensity={0.9}/>
        <directionalLight position={[3, 4, 5]} intensity={2.5} color="#dffff0"/>
        <pointLight position={[-4, -2, 2]} intensity={18} distance={8} color="#3d73ff"/>
        <pointLight position={[4, 1, 1]} intensity={12} distance={7} color="#8258ff"/>
        <OrbMesh/>
      </Canvas>
    </div>
  );
}
