import { removeBackground } from '@imgly/background-removal';

self.onmessage = async (e) => {
  try {
    const { imageUrl } = e.data;
    const processedBlob = await removeBackground(imageUrl);
    self.postMessage({ success: true, blob: processedBlob });
  } catch (error: any) {
    self.postMessage({ success: false, error: error?.message || 'Unknown error' });
  }
}; 