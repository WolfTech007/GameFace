"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import FacePong from "@/components/FacePong";

export default function FacePongPlayPage() {
  return (
    <GamePlayEntrance expectedPrivateGameSlug="facepong">
      {({
        autoJoinPublicQueue,
        fromRandomMatch,
        privateInviteLoading,
        privateInviteError,
        privateMatch,
        privateInviteCode,
      }) => (
        <FacePong
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          privateInviteLoading={privateInviteLoading}
          privateInviteError={privateInviteError}
          privateMatch={privateMatch}
          privateInviteCode={privateInviteCode}
          introSlug="facepong"
        />
      )}
    </GamePlayEntrance>
  );
}
