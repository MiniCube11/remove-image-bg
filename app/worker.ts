import { removeBackground } from '@imgly/background-removal';

self.onmessage = async (e) => {
  const { imageUrl, selectionData } = e.data;
  
  try {
    // Report initial progress
    self.postMessage({ type: 'progress', progress: 5, step: 'Loading image...' });

    // Load the image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Report progress
    self.postMessage({ type: 'progress', progress: 15, step: 'Preparing image...' });

    // Process the image with background removal
    const processedBlob = await removeBackground(blob, {
      progress: (key, current, total) => {
        // Map the progress to a more continuous range (15-95)
        // Add some randomness to prevent getting stuck at specific percentages
        const baseProgress = 15 + (current / total) * 80;
        const jitter = Math.random() * 2 - 1; // Random value between -1 and 1
        const progress = Math.min(95, Math.max(15, Math.round(baseProgress + jitter)));
        
        self.postMessage({ 
          type: 'progress', 
          progress,
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