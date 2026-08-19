/**
 * Google Vision calls for avize. Keep separate from Baumit text parsing (avizOcr.js).
 */
const VISION_IMAGES_URL = 'https://vision.googleapis.com/v1/images:annotate';
const VISION_FILES_URL = 'https://vision.googleapis.com/v1/files:annotate';

export function visionApiKey() {
  return process.env.GOOGLE_VISION_API_KEY?.trim() || '';
}

export async function visionAnnotateImage(base64Content, apiKey) {
  const res = await fetch(`${VISION_IMAGES_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64Content },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || res.statusText || 'Vision API error');
  }
  const response = data.responses?.[0];
  if (response?.error) throw new Error(response.error.message || 'Vision annotation failed');
  return response?.fullTextAnnotation?.text || response?.textAnnotations?.[0]?.description || '';
}

/** PDF rasterization path: Vision files:annotate on the first pages (no local image conversion). */
export async function visionAnnotatePdf(buffer, apiKey) {
  const res = await fetch(`${VISION_FILES_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        inputConfig: {
          content: buffer.toString('base64'),
          mimeType: 'application/pdf',
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        pages: [1, 2, 3],
      }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || res.statusText || 'Vision PDF error');
  }
  const pages = data.responses?.[0]?.responses || [];
  return pages.map((p) => p.fullTextAnnotation?.text || '').join('\n');
}

export function isTextPoor(rawText, minChars = 40) {
  return String(rawText || '').trim().length < minChars;
}
