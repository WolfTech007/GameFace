"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import FaceCard from "@/components/FaceCard";

export default function FaceCardPlayPage() {
  return (
    <GamePlayEntrance expectedPrivateGameSlug="facecard">
      {({
        autoJoinPublicQueue,
        fromRandomMatch,
        privateInviteLoading,
        privateInviteError,
        privateMatch,
        privateInviteCode,
      }) => (
        <FaceCard
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          privateInviteLoading={privateInviteLoading}
          privateInviteError={privateInviteError}
          privateMatch={privateMatch}
          privateInviteCode={privateInviteCode}
          introSlug="facecard"
        />
      )}
    </GamePlayEntrance>
  );
}
