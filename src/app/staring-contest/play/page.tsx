"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import StaringContest from "@/components/StaringContest";

export default function StaringContestPlayPage() {
  return (
    <GamePlayEntrance>
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <StaringContest
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          introSlug="staring-contest"
        />
      )}
    </GamePlayEntrance>
  );
}
