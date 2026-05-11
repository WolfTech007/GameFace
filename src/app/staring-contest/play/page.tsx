"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import StaringContest from "@/components/StaringContest";

export default function StaringContestPlayPage() {
  return (
    <GamePlayEntrance introHref="/staring-contest">
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <StaringContest
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introHref="/staring-contest"
        />
      )}
    </GamePlayEntrance>
  );
}
