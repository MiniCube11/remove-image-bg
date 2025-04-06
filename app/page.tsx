'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { removeBackground } from '@imgly/background-removal';

type BackgroundOption = 'none' | 'blur' | 'bw' | 'color';

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [processedImageNoBg, setProcessedImageNoBg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [backgroundOption, setBackgroundOption] = useState<BackgroundOption>('none');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [blurIntensity, setBlurIntensity] = useState(10);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initialize worker
    workerRef.current = new Worker(new URL('./worker.ts', import.meta.url));
    
    // Handle worker messages
    workerRef.current.onmessage = (e) => {
      const { type, progress, success, blob, error } = e.data;
      
      if (type === 'progress') {
        setProcessingProgress(progress);
        if (progress < 30) {
          setProcessingStep('Optimizing image...');
        } else if (progress < 100) {
          setProcessingStep('Removing background...');
        } else {
          setProcessingStep('Finalizing...');
        }
      } else if (type === 'complete') {
        if (success && blob) {
          const processedUrl = URL.createObjectURL(blob);
          setProcessedImageNoBg(processedUrl);
          setProcessedImage(processedUrl);
        } else {
          console.error('Error processing image:', error);
        }
        setIsProcessing(false);
        setProcessingProgress(0);
        setProcessingStep('');
      }
    };

    // Cleanup worker on unmount
    return () => {
      workerRef.current?.terminate();
      if (colorChangeTimeoutRef.current) {
        clearTimeout(colorChangeTimeoutRef.current);
      }
    };
  }, []);

  const applyBackgroundEffect = useCallback(async (originalUrl: string, foregroundUrl: string, option: BackgroundOption) => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Load original and foreground images
    const [originalImg, foregroundImg] = await Promise.all([
      createImageBitmap(await fetch(originalUrl).then(r => r.blob())),
      createImageBitmap(await fetch(foregroundUrl).then(r => r.blob()))
    ]);

    // Set canvas size
    canvas.width = originalImg.width;
    canvas.height = originalImg.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (option === 'none') {
      // For no background, just return the foreground image
      ctx.drawImage(foregroundImg, 0, 0);
    } else {
      // Fill with background color first
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (option === 'blur') {
        // Draw original image
        ctx.drawImage(originalImg, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCtx.putImageData(imageData, 0, 0);

        // Apply blur effect with adjustable intensity
        ctx.filter = `blur(${blurIntensity}px)`;
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.filter = 'none';
      } else if (option === 'bw') {
        // Draw original image
        ctx.drawImage(originalImg, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          data[i] = avg;     // red
          data[i + 1] = avg; // green
          data[i + 2] = avg; // blue
        }
        ctx.putImageData(imageData, 0, 0);
      }

      // Draw foreground on top
      ctx.drawImage(foregroundImg, 0, 0);
    }

    // Convert to blob and create URL
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
      }, 'image/png');
    });
    return URL.createObjectURL(blob);
  }, [backgroundColor, blurIntensity]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create URL for the original image
    const imageUrl = URL.createObjectURL(file);
    setOriginalImage(imageUrl);
    setProcessedImage(null);
    setProcessedImageNoBg(null);
    setIsProcessing(true);

    // Send image to worker for processing
    workerRef.current?.postMessage({ imageUrl });
  };

  const handleBackgroundChange = useCallback(async (option: BackgroundOption) => {
    if (!originalImage || !processedImageNoBg) return;
    
    setBackgroundOption(option);
    
    if (option === 'none') {
      // For no background, use the original processed image
      setProcessedImage(processedImageNoBg);
    } else {
      // Apply the selected background effect
      const newProcessedUrl = await applyBackgroundEffect(originalImage, processedImageNoBg, option);
      if (newProcessedUrl) {
        setProcessedImage(newProcessedUrl);
      }
    }
  }, [originalImage, processedImageNoBg, applyBackgroundEffect]);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBackgroundColor(e.target.value);
    
    // Clear any existing timeout
    if (colorChangeTimeoutRef.current) {
      clearTimeout(colorChangeTimeoutRef.current);
    }
    
    // Set a new timeout to debounce the color change
    colorChangeTimeoutRef.current = setTimeout(() => {
      if (backgroundOption === 'color') {
        handleBackgroundChange('color');
      }
    }, 100); // 100ms debounce
  };

  const handleBlurChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBlurIntensity(Number(e.target.value));
    if (backgroundOption === 'blur') {
      handleBackgroundChange('blur');
    }
  };

  return (
    <div className="min-h-screen p-8">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">Background Remover</h1>
        
        <div className="flex flex-col items-center gap-8">
          <div className="w-full max-w-md">
            <label className="block w-full p-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-500 transition-colors">
              <div className="text-center">
                <p className="text-lg font-medium">Upload Image</p>
                <p className="text-sm text-gray-500">Click to select or drag and drop</p>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
          </div>

          {isProcessing && (
            <div className="text-center w-full max-w-md">
              <p className="text-lg mb-2">{processingStep}</p>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                <div 
                  className="bg-blue-500 h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${processingProgress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-500">{processingProgress}% complete</p>
            </div>
          )}

          {processedImage && (
            <div className="flex flex-col gap-4 items-center">
              <div className="flex gap-4">
                <button
                  onClick={() => handleBackgroundChange('none')}
                  className={`px-4 py-2 rounded ${
                    backgroundOption === 'none'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                >
                  No Background
                </button>
                <button
                  onClick={() => handleBackgroundChange('blur')}
                  className={`px-4 py-2 rounded ${
                    backgroundOption === 'blur'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                >
                  Blurred Background
                </button>
                <button
                  onClick={() => handleBackgroundChange('bw')}
                  className={`px-4 py-2 rounded ${
                    backgroundOption === 'bw'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                >
                  Black & White Background
                </button>
                <button
                  onClick={() => handleBackgroundChange('color')}
                  className={`px-4 py-2 rounded ${
                    backgroundOption === 'color'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                >
                  Custom Color
                </button>
              </div>
              
              {backgroundOption === 'color' && (
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium">Background Color:</label>
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={handleColorChange}
                    className="w-12 h-12 rounded cursor-pointer"
                  />
                </div>
              )}

              {backgroundOption === 'blur' && (
                <div className="flex flex-col items-center gap-2 w-full max-w-md">
                  <label className="text-sm font-medium">Blur Intensity: {blurIntensity}px</label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={blurIntensity}
                    onChange={handleBlurChange}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
            {originalImage && (
              <div className="flex flex-col items-center">
                <h2 className="text-xl font-semibold mb-4">Original Image</h2>
                <div className="relative w-full aspect-square">
                  <Image
                    src={originalImage}
                    alt="Original"
                    fill
                    className="object-contain"
                  />
                </div>
              </div>
            )}

            {processedImage && (
              <div className="flex flex-col items-center">
                <h2 className="text-xl font-semibold mb-4">Processed Image</h2>
                <div className="relative w-full aspect-square">
                  <Image
                    src={processedImage}
                    alt="Processed"
                    fill
                    className="object-contain"
                  />
                </div>
                <a
                  href={processedImage}
                  download="processed-image.png"
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Download
                </a>
              </div>
            )}
          </div>
        </div>
      </main>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
