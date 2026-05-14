"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import FaceCard from "@/components/FaceCard";

export default function FaceCardPlayPage() {
  return (
    <GamePlayEntrance introHref="/facecard">
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <FaceCard
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introHref="/facecard"
        />
      )}
    </GamePlayEntrance>
  );
}
