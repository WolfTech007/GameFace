/** Shared tuning for Blink Stacker (V1 solo). */

export const BLINK_COOLDOWN_MS = 420;

/** Default EAR threshold when calibration has not run yet (eyes open ~0.22–0.32 typical). */
export const EAR_BLINK_FALLBACK_THRESHOLD = 0.19;

/** After calibration: blink when EAR drops below this fraction of the recent “eyes open” baseline. */
export const EAR_BLINK_FRAC_OF_OPEN = 0.62;

export const EAR_CALIBRATION_FRAMES = 45;

/** Minimum overlap length as a fraction of the *moving* block’s width — below this is a miss. */
export const OVERLAP_WIN_MIN = 0.5;

/** “Perfect” stop: overlap covers almost the entire moving block → bonus + flair. */
export const PERFECT_OVERLAP_MIN = 0.98;

export const PERFECT_BONUS_SCORE = 25;

export const BASE_SCORE_PER_LEVEL = 10;

/** Horizontal speed (px/s) at level 1; added per successful level until cap. */
export const SPEED_BASE_PX = 260;
export const SPEED_PER_LEVEL_PX = 22;
export const SPEED_MAX_PX = 640;

export const COUNTDOWN_SEC = 3;

export const STORAGE_BEST_KEY = "gameface_blink_stacker_best_v1";
