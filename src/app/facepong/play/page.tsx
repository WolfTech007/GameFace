"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import FacePong from "@/components/FacePong";

export default function FacePongPlayPage() {
  return (
    <GamePlayEntrance introHref="/facepong">
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <FacePong
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introHref="/facepong"
        />
      )}
    </GamePlayEntrance>
  );
}
