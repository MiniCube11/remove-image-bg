import { removeBackground } from '@imgly/background-removal';

self.onmessage = async (e) => {
  const { imageUrl, selectionData } = e.data;
  
  try {
    // Report initial progress
    self.postMessage({ type: 'progress', progress: 0, step: 'Loading image...' });

    // Load the image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Report progress
    self.postMessage({ type: 'progress', progress: 20, step: 'Processing image...' });

    // Process the image with background removal
    const processedBlob = await removeBackground(blob, {
      progress: (key, current, total) => {
        const progress = 20 + (current / total) * 80;
        self.postMessage({ 
          type: 'progress', 
          progress: Math.round(progress),
          step: 'Removing background...'
        });
      },
      // If selection data is provided, use it to guide the removal
      ...(selectionData && {
        mask: {
          data: selectionData.data,
          width: selectionData.width,
          height: selectionData.height
        }
      })
    });

    // Report completion
    self.postMessage({ 
      type: 'complete', 
      success: true, 
      blob: processedBlob 
    });
  } catch (error) {
    self.postMessage({ 
      type: 'complete', 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    });
  }
}; 