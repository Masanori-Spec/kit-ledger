import { planSnapshot } from "./src/core.mjs";
self.onmessage = ({ data }) => {
  try {
    const report = planSnapshot(data.text, {
      onProgress: (progress) => {
        if (progress.visited === 1 || progress.visited % 8192 === 0)
          self.postMessage({ id: data.id, type: "progress", progress });
      },
    });
    self.postMessage({ id: data.id, type: "result", report });
  } catch (error) {
    self.postMessage({
      id: data.id,
      type: "error",
      code: error.code ?? "ERROR",
      message: error.message,
    });
  }
};
