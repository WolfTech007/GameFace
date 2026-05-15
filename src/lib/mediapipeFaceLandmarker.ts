import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let singleton: FaceLandmarker | null = null;

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

async function createLandmarker(delegate: "GPU" | "CPU") {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      delegate,
      modelAssetPath: MODEL_URL,
    },
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export async function createFaceLandmarker() {
  if (singleton) return singleton;

  try {
    singleton = await createLandmarker("GPU");
  } catch {
    singleton = await createLandmarker("CPU");
  }

  return singleton;
}

