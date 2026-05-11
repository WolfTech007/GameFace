"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import LipReader from "@/components/LipReader";

export default function CharadesPlayPage() {
  return (
    <GamePlayEntrance introHref="/charades">
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <LipReader
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introHref="/charades"
        />
      )}
    </GamePlayEntrance>
  );
}
