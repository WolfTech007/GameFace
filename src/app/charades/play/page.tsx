"use client";

import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import LipReader from "@/components/LipReader";

export default function CharadesPlayPage() {
  return (
    <GamePlayEntrance expectedPrivateGameSlug="lipreader">
      {({
        autoJoinPublicQueue,
        fromRandomMatch,
        privateInviteLoading,
        privateInviteError,
        privateMatch,
        privateInviteCode,
      }) => (
        <LipReader
          autoJoinPublicQueue={autoJoinPublicQueue}
          fromRandomMatch={fromRandomMatch}
          privateInviteLoading={privateInviteLoading}
          privateInviteError={privateInviteError}
          privateMatch={privateMatch}
          privateInviteCode={privateInviteCode}
          introSlug="charades"
        />
      )}
    </GamePlayEntrance>
  );
}
