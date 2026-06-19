import { useEffect, useState } from "react";
import {
  modelDownloadManager,
  type DownloadState,
} from "../services/modelDownloadManager";

export function useModelDownload(): DownloadState {
  const [state, setState] = useState<DownloadState>(() =>
    modelDownloadManager.getState(),
  );
  useEffect(() => modelDownloadManager.subscribe(setState), []);
  return state;
}
