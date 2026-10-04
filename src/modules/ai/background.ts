// Side-effect entry for the root index.ts: defines the model download background task before the
// router loads, without pulling in the rest of the AI module on a headless launch.
import "./local/modelDownloadTask";
