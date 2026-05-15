"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import FaceCard from "@/components/FaceCard";

export default function FaceCardPlayPage() {
  return (
    <GamePlayEntrance>
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <FaceCard
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introSlug="facecard"
        />
      )}
    </GamePlayEntrance>
  );
}
