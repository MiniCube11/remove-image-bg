'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { removeBackground } from '@imgly/background-removal';

type BackgroundOption = 'none' | 'blur' | 'bw' | 'color' | 'border';
type SelectionMode = 'foreground' | 'background' | 'none';

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
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [borderSize, setBorderSize] = useState(40);
  const [borderColor, setBorderColor] = useState('#ffffff');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const borderChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    // Cleanup worker and timeouts on unmount
    return () => {
      workerRef.current?.terminate();
      if (colorChangeTimeoutRef.current) {
        clearTimeout(colorChangeTimeoutRef.current);
      }
      if (borderChangeTimeoutRef.current) {
        clearTimeout(borderChangeTimeoutRef.current);
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
    } else if (option === 'border') {
      // Create temporary canvas for the border effect
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      // Calculate border thickness (scaled based on the slider value)
      const thickness = Math.max(1, Math.floor(borderSize / 8));
      
      // Set canvas dimensions with padding for the border
      tempCanvas.width = canvas.width + thickness * 2;
      tempCanvas.height = canvas.height + thickness * 2;

      // Create a mask canvas for the border shape
      const maskCanvas = document.createElement('canvas');
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) return;
      maskCanvas.width = tempCanvas.width;
      maskCanvas.height = tempCanvas.height;

      // Generate circular offsets for the border
      const offsets: [number, number][] = [];
      for (let x = -thickness; x <= thickness; x++) {
        for (let y = -thickness; y <= thickness; y++) {
          if (x * x + y * y <= thickness * thickness) {
            offsets.push([x, y]);
          }
        }
      }

      // Draw the expanded shape in white to create a mask
      maskCtx.fillStyle = '#ffffff';
      offsets.forEach(([dx, dy]) => {
        maskCtx.drawImage(foregroundImg, dx + thickness, dy + thickness);
      });

      // Clear the temporary canvas
      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

      // Fill the entire temporary canvas with the border color
      tempCtx.fillStyle = borderColor;
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      // Use the mask to cut out the border shape
      tempCtx.globalCompositeOperation = 'destination-in';
      tempCtx.drawImage(maskCanvas, 0, 0);

      // Clear the main canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the colored border
      ctx.drawImage(
        tempCanvas, 
        -thickness, 
        -thickness, 
        tempCanvas.width, 
        tempCanvas.height
      );

      // Draw the original image on top
      ctx.drawImage(foregroundImg, 0, 0);
    } else {
      // Fill with background color first
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (option === 'blur') {
        // Step 1: Create and blur the background
        const bgCanvas = document.createElement('canvas');
        const bgCtx = bgCanvas.getContext('2d');
        if (!bgCtx) return;
        bgCanvas.width = canvas.width;
        bgCanvas.height = canvas.height;

        // Apply blur to the entire background
        bgCtx.filter = `blur(${blurIntensity}px)`;
        bgCtx.drawImage(originalImg, 0, 0);
        bgCtx.filter = 'none';

        // Step 2: Draw blurred background to main canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bgCanvas, 0, 0);

        // Step 3: Mask out the subject area (punch a hole)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(foregroundImg, 0, 0);

        // Step 4: Restore blend mode and draw original subject
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(foregroundImg, 0, 0);
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
  }, [backgroundColor, blurIntensity, borderColor, borderSize]);

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0];

    if (!file) return;

    // Check if file is an image
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    // Check file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      return;
    }

    // Create URL for the original image
    const imageUrl = URL.createObjectURL(file);
    setOriginalImage(imageUrl);
    setProcessedImage(null);
    setProcessedImageNoBg(null);
    setIsProcessing(true);

    // Send image to worker for processing
    workerRef.current?.postMessage({ imageUrl });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if file is an image
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    // Check file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      return;
    }

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

  const handleSelectionStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectionMode === 'none') return;
    setIsDrawing(true);
    const canvas = selectionCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastPointRef.current = { x, y };
  };

  const handleSelectionMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || selectionMode === 'none') return;
    const canvas = selectionCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(x, y);
      ctx.strokeStyle = selectionMode === 'foreground' ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 0, 0, 0.5)';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    lastPointRef.current = { x, y };
  };

  const handleSelectionEnd = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const clearSelection = () => {
    const canvas = selectionCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const applySelection = async () => {
    if (!originalImage || !processedImageNoBg || !selectionCanvasRef.current) return;

    const selectionCanvas = selectionCanvasRef.current;
    const selectionCtx = selectionCanvas.getContext('2d');
    if (!selectionCtx) return;

    // Get the selection mask
    const selectionData = selectionCtx.getImageData(0, 0, selectionCanvas.width, selectionCanvas.height);
    
    // Convert the selection mask to the format expected by the worker
    const maskData = new Uint8Array(selectionData.width * selectionData.height);
    for (let i = 0; i < selectionData.data.length; i += 4) {
      // Use the red channel to determine if it's a background mark
      const isBackground = selectionData.data[i] > 0;
      maskData[i / 4] = isBackground ? 0 : 255; // 0 for background, 255 for foreground
    }

    // Set processing state
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessingStep('Processing selection...');

    // Clear the selection canvas
    clearSelection();

    // Send the image and selection mask to the worker
    workerRef.current?.postMessage({
      imageUrl: originalImage,
      selectionData: {
        data: maskData,
        width: selectionData.width,
        height: selectionData.height
      }
    });
  };

  const handleSelectClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleBorderColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBorderColor(e.target.value);
    
    // Clear any existing timeout
    if (colorChangeTimeoutRef.current) {
      clearTimeout(colorChangeTimeoutRef.current);
    }
    
    // Set a new timeout to debounce the color change
    colorChangeTimeoutRef.current = setTimeout(() => {
      if (backgroundOption === 'border') {
        handleBackgroundChange('border');
      }
    }, 150); // 150ms debounce
  };

  const handleBorderSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBorderSize(Number(e.target.value));
    
    // Clear any existing timeout
    if (borderChangeTimeoutRef.current) {
      clearTimeout(borderChangeTimeoutRef.current);
    }
    
    // Set a new timeout to debounce the border size change
    borderChangeTimeoutRef.current = setTimeout(() => {
      if (backgroundOption === 'border') {
        handleBackgroundChange('border');
      }
    }, 150); // 150ms debounce
  };

  return (
    <div className="min-h-screen py-16 px-4 bg-[#FAFAFA]">
      <main className="max-w-3xl mx-auto">
        <h1 className="text-[36px] font-bold mb-6 text-center tracking-tight">
          <span className="bg-gradient-to-r from-indigo-600 to-purple-500 text-transparent bg-clip-text">Remove  image backgrounds</span> in seconds
        </h1>
        <p className="text-center text-gray-600 mb-12 max-w-xl mx-auto">
          Remove backgrounds in one click. Add stylish filters, borders, and more with our editor—100% free, no sign-up required.
        </p>
        
        <div className="flex flex-col items-center gap-12">
          <div className="w-full">
            <label 
              className={`block w-full p-16 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 bg-white
                ${isDragging ? 'border-[#4F46E5] bg-[#F5F7FF]' : 'border-gray-300 hover:border-[#4F46E5]'}`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="text-center flex flex-col items-center gap-6">
                <div className={`w-16 h-16 transition-colors duration-200 ${isDragging ? 'text-[#4F46E5]' : 'text-gray-400'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-full h-full">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <p className={`text-[20px] font-medium tracking-tight transition-colors duration-200 ${isDragging ? 'text-[#4F46E5]' : 'text-gray-900'}`}>
                    Drag and drop your image here
                  </p>
                  <p className="text-[14px] text-gray-600">or click to select a file</p>
                </div>
                <button
                  type="button"
                  onClick={handleSelectClick}
                  className="mt-2 px-8 py-2.5 bg-[#4F46E5] text-[14px] font-medium text-white rounded-md hover:bg-[#4338CA] transition-colors"
                >
                  Select Image
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
          </div>

          {isProcessing && (
            <div className="text-center w-full">
              <p className="text-[16px] font-medium mb-3">{processingStep}</p>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div 
                  className="bg-[#4F46E5] h-2 rounded-full transition-all duration-300" 
                  style={{ width: `${processingProgress}%` }}
                ></div>
              </div>
              <p className="text-[14px] text-gray-600">{processingProgress}% complete</p>
            </div>
          )}

          {processedImage && (
            <div className="flex flex-col gap-6 items-center w-full">
              <div className="flex gap-3 flex-wrap justify-center">
                <button
                  onClick={() => handleBackgroundChange('none')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    backgroundOption === 'none'
                      ? 'bg-[#4F46E5] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  No Background
                </button>
                <button
                  onClick={() => handleBackgroundChange('border')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    backgroundOption === 'border'
                      ? 'bg-[#4F46E5] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Sticker Border
                </button>
                <button
                  onClick={() => handleBackgroundChange('blur')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    backgroundOption === 'blur'
                      ? 'bg-[#4F46E5] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Blurred Background
                </button>
                <button
                  onClick={() => handleBackgroundChange('bw')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    backgroundOption === 'bw'
                      ? 'bg-[#4F46E5] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Black & White Background
                </button>
                <button
                  onClick={() => handleBackgroundChange('color')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    backgroundOption === 'color'
                      ? 'bg-[#4F46E5] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Custom Color
                </button>
              </div>

              <div className="flex gap-3 flex-wrap justify-center">
                <button
                  onClick={() => setSelectionMode(selectionMode === 'foreground' ? 'none' : 'foreground')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    selectionMode === 'foreground'
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Mark Foreground
                </button>
                <button
                  onClick={() => setSelectionMode(selectionMode === 'background' ? 'none' : 'background')}
                  className={`px-5 py-2.5 rounded-md text-[14px] font-medium ${
                    selectionMode === 'background'
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Mark Background
                </button>
                <button
                  onClick={clearSelection}
                  className="px-5 py-2.5 rounded-md text-[14px] font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  Clear Selection
                </button>
                <button
                  onClick={applySelection}
                  className="px-5 py-2.5 rounded-md text-[14px] font-medium bg-[#4F46E5] text-white hover:bg-[#4338CA]"
                >
                  Apply Selection
                </button>
              </div>

              {selectionMode !== 'none' && (
                <div className="flex flex-col items-center gap-3 w-full max-w-md">
                  <label className="text-[14px] font-medium text-gray-700">Brush Size: {brushSize}px</label>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}
              
              {backgroundOption === 'color' && (
                <div className="flex items-center gap-4">
                  <label className="text-[14px] font-medium text-gray-700">Background Color:</label>
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={handleColorChange}
                    className="w-12 h-12 rounded cursor-pointer"
                  />
                </div>
              )}

              {backgroundOption === 'blur' && (
                <div className="flex flex-col items-center gap-3 w-full max-w-md">
                  <label className="text-[14px] font-medium text-gray-700">Blur Intensity: {blurIntensity}px</label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={blurIntensity}
                    onChange={handleBlurChange}
                    className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}

              {backgroundOption === 'border' && (
                <div className="flex flex-col items-center gap-3 w-full max-w-md">
                  <div className="flex items-center gap-4 w-full">
                    <label className="text-[14px] font-medium text-gray-700">Border Color:</label>
                    <input
                      type="color"
                      value={borderColor}
                      onChange={handleBorderColorChange}
                      className="w-12 h-12 rounded cursor-pointer"
                    />
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                    <label className="text-[14px] font-medium text-gray-700">Border Width: {borderSize}px</label>
                    <input
                      type="range"
                      min="20"
                      max="200"
                      step="5"
                      value={borderSize}
                      onChange={handleBorderSizeChange}
                      className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 w-full">
            {originalImage && (
              <div className="flex flex-col items-center">
                <h2 className="text-[16px] font-semibold mb-6">Original Image</h2>
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
                <h2 className="text-[16px] font-semibold mb-6">Processed Image</h2>
                <div className="relative w-full aspect-square">
                  <Image
                    src={processedImage}
                    alt="Processed"
                    fill
                    className="object-contain"
                  />
                  {selectionMode !== 'none' && (
                    <canvas
                      ref={selectionCanvasRef}
                      className="absolute inset-0 w-full h-full"
                      onMouseDown={handleSelectionStart}
                      onMouseMove={handleSelectionMove}
                      onMouseUp={handleSelectionEnd}
                      onMouseLeave={handleSelectionEnd}
                    />
                  )}
                </div>
                <a
                  href={processedImage}
                  download="processed-image.png"
                  className="mt-6 px-6 py-2.5 bg-[#4F46E5] text-[14px] font-medium text-white rounded-md hover:bg-[#4338CA] transition-colors"
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
