"use client";

import StackUp from "@/components/StackUp";
import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";
import playStyles from "./play.module.css";

export default function StackUpPlayPage() {
  return (
    <div className={playStyles.playRoute}>
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
    </div>
  );
}
