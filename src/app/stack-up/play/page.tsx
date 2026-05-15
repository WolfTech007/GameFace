"use client";

import StackUp from "@/components/StackUp";
import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";

export default function StackUpPlayPage() {
  return (
    <GamePlayEntrance expectedPrivateGameSlug="stack-up">
      {({
        autoJoinPublicQueue,
        fromRandomMatch,
        privateInviteLoading,
        privateInviteError,
        privateMatch,
        privateInviteCode,
      }) => (
        <StackUp
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          privateInviteLoading={privateInviteLoading}
          privateInviteError={privateInviteError}
          privateMatch={privateMatch}
          privateInviteCode={privateInviteCode}
          introSlug="stack-up"
        />
      )}
    </GamePlayEntrance>
  );
}
