const DEFAULT_MIN_BYTES_TO_PROCESS = 700 * 1024;
const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1600;
const DEFAULT_QUALITY = 0.82;
export const DEFAULT_IMAGE_FRAME = Object.freeze({ zoom: 1, x: 50, y: 50 });

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
}

export function normalizeImageFrame(frame, defaults = DEFAULT_IMAGE_FRAME) {
  const source = frame && typeof frame === "object" ? frame : {};
  return {
    zoom: clampNumber(source.zoom, 1, 2.2, defaults.zoom),
    x: clampNumber(source.x, 0, 100, defaults.x),
    y: clampNumber(source.y, 0, 100, defaults.y)
  };
}

function getMeasuredFrameHost(imageEl) {
  const hostEl = imageEl?.parentElement;
  if (!hostEl) return null;

  const hostWidth = Math.max(hostEl.clientWidth || hostEl.offsetWidth || 0, 0);
  const hostHeight = Math.max(hostEl.clientHeight || hostEl.offsetHeight || 0, 0);
  if (!hostWidth || !hostHeight) return null;

  return { hostEl, hostWidth, hostHeight };
}

function getFrameLayout(hostWidth, hostHeight, imageWidth, imageHeight, frame = DEFAULT_IMAGE_FRAME) {
  const safeHostWidth = Math.max(Number(hostWidth) || 1, 1);
  const safeHostHeight = Math.max(Number(hostHeight) || 1, 1);
  const safeImageWidth = Math.max(Number(imageWidth) || 1, 1);
  const safeImageHeight = Math.max(Number(imageHeight) || 1, 1);
  const safeFrame = normalizeImageFrame(frame);
  const baseScale = Math.max(safeHostWidth / safeImageWidth, safeHostHeight / safeImageHeight);
  const drawWidth = Math.max(1, safeImageWidth * baseScale * safeFrame.zoom);
  const drawHeight = Math.max(1, safeImageHeight * baseScale * safeFrame.zoom);

  return {
    width: drawWidth,
    height: drawHeight,
    x: (safeHostWidth - drawWidth) * (safeFrame.x / 100),
    y: (safeHostHeight - drawHeight) * (safeFrame.y / 100)
  };
}

function applyPreviewFrameStyles(imageEl, layout) {
  const hostEl = imageEl?.parentElement;
  if (!imageEl || !hostEl || !layout) return;

  const hostStyles = window.getComputedStyle(hostEl);
  if (hostStyles.position === "static") {
    hostEl.style.position = "relative";
  }
  if (hostStyles.overflow === "visible") {
    hostEl.style.overflow = "hidden";
  }

  imageEl.style.position = "absolute";
  imageEl.style.inset = "auto";
  imageEl.style.left = `${layout.x}px`;
  imageEl.style.top = `${layout.y}px`;
  imageEl.style.width = `${layout.width}px`;
  imageEl.style.height = `${layout.height}px`;
  imageEl.style.maxWidth = "none";
  imageEl.style.maxHeight = "none";
  imageEl.style.display = "block";
  imageEl.style.objectFit = "fill";
  imageEl.style.objectPosition = "50% 50%";
  imageEl.style.transformOrigin = "center center";
  imageEl.style.transform = "none";
}

export function applyImageFrameToElement(imageEl, frame, defaults = DEFAULT_IMAGE_FRAME) {
  if (!imageEl) return;
  const safeFrame = normalizeImageFrame(frame, defaults);

  let scheduled = false;
  const renderFrame = () => {
    const hostMeasurement = getMeasuredFrameHost(imageEl);
    const naturalWidth = Math.max(imageEl.naturalWidth || imageEl.clientWidth || 0, 0);
    const naturalHeight = Math.max(imageEl.naturalHeight || imageEl.clientHeight || 0, 0);

    if (!hostMeasurement || !naturalWidth || !naturalHeight) {
      if (!scheduled && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        scheduled = true;
        window.requestAnimationFrame(() => {
          scheduled = false;
          const retryHostMeasurement = getMeasuredFrameHost(imageEl);
          const retryNaturalWidth = Math.max(imageEl.naturalWidth || imageEl.clientWidth || 0, 0);
          const retryNaturalHeight = Math.max(imageEl.naturalHeight || imageEl.clientHeight || 0, 0);
          if (!retryHostMeasurement || !retryNaturalWidth || !retryNaturalHeight) return;

          const retryLayout = getFrameLayout(
            retryHostMeasurement.hostWidth,
            retryHostMeasurement.hostHeight,
            retryNaturalWidth,
            retryNaturalHeight,
            safeFrame
          );
          applyPreviewFrameStyles(imageEl, retryLayout);
        });
      }
      return;
    }

    const layout = getFrameLayout(
      hostMeasurement.hostWidth,
      hostMeasurement.hostHeight,
      naturalWidth,
      naturalHeight,
      safeFrame
    );
    applyPreviewFrameStyles(imageEl, layout);
  };

  if (!imageEl.complete || !imageEl.naturalWidth || !imageEl.naturalHeight) {
    imageEl.addEventListener("load", renderFrame, { once: true });
  }

  renderFrame();
}

function getAspectTargetDimensions(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(Number(width) || 1, 1);
  const safeHeight = Math.max(Number(height) || 1, 1);
  const aspectRatio = safeWidth / safeHeight;

  let targetWidth = maxWidth > 0 ? maxWidth : safeWidth;
  let targetHeight = Math.max(1, Math.round(targetWidth / aspectRatio));

  if (maxHeight > 0 && targetHeight > maxHeight) {
    targetHeight = maxHeight;
    targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
  }

  return {
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(targetHeight))
  };
}

function isOptimizableImage(file) {
  if (!(file instanceof File)) return false;
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function loadImageFromObjectURL(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
        draw(context, x, y, width, height) {
          context.drawImage(image, x, y, width, height);
        },
        cleanup() {
          URL.revokeObjectURL(objectUrl);
        }
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not load the selected image."));
    };

    image.src = objectUrl;
  });
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width || 0,
        height: bitmap.height || 0,
        draw(context, x, y, width, height) {
          context.drawImage(bitmap, x, y, width, height);
        },
        cleanup() {
          if (typeof bitmap.close === "function") {
            bitmap.close();
          }
        }
      };
    } catch (error) {
      // Fall back to Image() below.
    }
  }

  return loadImageFromObjectURL(file);
}

function getTargetDimensions(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(Number(width) || 0, 1);
  const safeHeight = Math.max(Number(height) || 0, 1);
  const widthRatio = maxWidth > 0 ? maxWidth / safeWidth : 1;
  const heightRatio = maxHeight > 0 ? maxHeight / safeHeight : 1;
  const scale = Math.min(1, widthRatio, heightRatio);

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Could not optimize the selected image."));
    }, type, quality);
  });
}

export async function createFramedImageFile(file, frame = DEFAULT_IMAGE_FRAME, options = {}) {
  if (!isOptimizableImage(file)) return file;

  const {
    outputWidth = 0,
    outputHeight = 0,
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    quality = DEFAULT_QUALITY
  } = options;

  try {
    const safeFrame = normalizeImageFrame(frame);
    const imageSource = await loadImageSource(file);

    try {
      const target = getAspectTargetDimensions(
        outputWidth || imageSource.width || 1,
        outputHeight || imageSource.height || 1,
        maxWidth,
        maxHeight
      );

      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;

      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        return file;
      }

      const baseScale = Math.max(
        target.width / Math.max(imageSource.width || 1, 1),
        target.height / Math.max(imageSource.height || 1, 1)
      );
      const drawWidth = Math.max(1, (imageSource.width || 1) * baseScale * safeFrame.zoom);
      const drawHeight = Math.max(1, (imageSource.height || 1) * baseScale * safeFrame.zoom);
      const drawX = (target.width - drawWidth) * (safeFrame.x / 100);
      const drawY = (target.height - drawHeight) * (safeFrame.y / 100);

      imageSource.draw(context, drawX, drawY, drawWidth, drawHeight);

      const outputType = String(file.type || "").trim() || "image/jpeg";
      const framedBlob = await canvasToBlob(canvas, outputType, quality);

      return new File([framedBlob], file.name, {
        type: outputType,
        lastModified: file.lastModified
      });
    } finally {
      imageSource.cleanup();
    }
  } catch (error) {
    console.warn("Image framing skipped:", error);
    return file;
  }
}

export async function optimizeImageFileForUpload(file, options = {}) {
  if (!isOptimizableImage(file)) return file;

  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    quality = DEFAULT_QUALITY,
    minBytesToProcess = DEFAULT_MIN_BYTES_TO_PROCESS
  } = options;

  try {
    const imageSource = await loadImageSource(file);

    try {
      const target = getTargetDimensions(imageSource.width, imageSource.height, maxWidth, maxHeight);
      const resized = target.width !== imageSource.width || target.height !== imageSource.height;
      const shouldProcess = resized || file.size >= minBytesToProcess;

      if (!shouldProcess) {
        return file;
      }

      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;

      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        return file;
      }

      imageSource.draw(context, 0, 0, target.width, target.height);

      const optimizedBlob = await canvasToBlob(canvas, file.type, quality);
      const savingsWereMeaningful = optimizedBlob.size <= file.size * 0.92;

      if (!resized && !savingsWereMeaningful) {
        return file;
      }

      return new File([optimizedBlob], file.name, {
        type: file.type,
        lastModified: file.lastModified
      });
    } finally {
      imageSource.cleanup();
    }
  } catch (error) {
    console.warn("Image optimization skipped:", error);
    return file;
  }
}
