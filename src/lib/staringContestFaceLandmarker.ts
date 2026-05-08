import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/** Separate singleton so FaceBreaker’s Face Landmarker options stay unchanged. */
let singleton: FaceLandmarker | null = null;

export async function createStaringContestLandmarker() {
  if (singleton) return singleton;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
  );

  singleton = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      delegate: "GPU",
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    },
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return singleton;
}
