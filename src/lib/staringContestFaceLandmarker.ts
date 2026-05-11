import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/** Separate singleton so FaceBreaker’s Face Landmarker options stay unchanged. */
let singleton: FaceLandmarker | null = null;
/** Increment when options change so existing singleton is reopened with new settings. */
const OPTS_VER = 2;
let loadedVer = 0;

export async function createStaringContestLandmarker() {
  if (singleton && loadedVer === OPTS_VER) return singleton;

  if (singleton) {
    try {
      singleton.close();
    } catch {
      /* ignore */
    }
    singleton = null;
  }

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
  );

  singleton = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      delegate: "GPU",
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  });

  loadedVer = OPTS_VER;
  return singleton;
}
