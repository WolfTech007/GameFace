"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import BlinkStackerDuel from "@/components/BlinkStackerDuel";

export default function BlinkStackerDuelPlayPage() {
  return (
    <GamePlayEntrance introHref="/blink-stacker-duel">
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <BlinkStackerDuel
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introHref="/blink-stacker-duel"
        />
      )}
    </GamePlayEntrance>
  );
}
