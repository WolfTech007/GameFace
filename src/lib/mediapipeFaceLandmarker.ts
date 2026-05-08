import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let singleton: FaceLandmarker | null = null;

export async function createFaceLandmarker() {
  if (singleton) return singleton;

  // WASM assets from jsDelivr so this works without hosting files locally.
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
    minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  return singleton;
}

