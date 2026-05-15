"use client";

import StackUp from "@/components/StackUp";
import { GamePlayEntrance } from "@/components/gameface/GamePlayEntrance";

export default function StackUpPlayPage() {
  return (
    <GamePlayEntrance introHref="/stack-up">
      {({ autoJoinPublicQueue, fromRandomMatch }) => (
        <StackUp autoJoinPublicQueue={autoJoinPublicQueue} fromRandomMatch={fromRandomMatch} introHref="/stack-up" />
      )}
    </GamePlayEntrance>
  );
}
