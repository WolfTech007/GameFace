"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import StaringContest from "@/components/StaringContest";

export default function StaringContestPlayPage() {
  return (
    <GamePlayEntrance expectedPrivateGameSlug="staring-contest">
      {({
        autoJoinPublicQueue,
        fromRandomMatch,
        privateInviteLoading,
        privateInviteError,
        privateMatch,
        privateInviteCode,
      }) => (
        <StaringContest
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          privateInviteLoading={privateInviteLoading}
          privateInviteError={privateInviteError}
          privateMatch={privateMatch}
          privateInviteCode={privateInviteCode}
          introSlug="staring-contest"
        />
      )}
    </GamePlayEntrance>
  );
}
