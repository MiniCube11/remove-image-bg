import { removeBackground } from '@imgly/background-removal';

self.onmessage = async (e) => {
  try {
    const { imageUrl } = e.data;
    
    // Report initial progress
    self.postMessage({ type: 'progress', progress: 10 });
    
    // Load image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Report optimization progress
    self.postMessage({ type: 'progress', progress: 30 });
    
    // Process the image
    const processedBlob = await removeBackground(imageUrl);
    
    // Report completion
    self.postMessage({ type: 'progress', progress: 100 });
    self.postMessage({ type: 'complete', success: true, blob: processedBlob });
  } catch (error: any) {
    self.postMessage({ type: 'complete', success: false, error: error?.message || 'Unknown error' });
  }
}; 