'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { removeBackground } from '@imgly/background-removal';

type BackgroundOption = 'none' | 'blur' | 'bw' | 'color' | 'border';

type ColorOption = {
  id: string;
  type: 'color' | 'transparent' | 'effect' | 'picker';
  label: string;
  color?: string;
  border?: boolean;
  icon?: string;
  onClick?: () => void;
};

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
  const [borderSize, setBorderSize] = useState(40);
  const [borderColor, setBorderColor] = useState('#ffffff');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const borderChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

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

  const applyBackgroundEffect = useCallback(async (
    originalUrl: string, 
    foregroundUrl: string, 
    option: BackgroundOption,
    options?: {
      color?: string;
      blur?: number;
      borderColor?: string;
      borderSize?: number;
    }
  ) => {
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
      // Draw checkerboard pattern for transparent background
      const size = 32; // Size of each square
      for (let x = 0; x < canvas.width; x += size) {
        for (let y = 0; y < canvas.height; y += size) {
          ctx.fillStyle = (x + y) % (size * 2) === 0 ? '#FFFFFF' : '#F5F7FA';
          ctx.fillRect(x, y, size, size);
        }
      }
      // Draw the foreground image
      ctx.drawImage(foregroundImg, 0, 0);
    } else if (option === 'border') {
      // Create temporary canvas for the border effect
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      // Calculate border thickness (scaled based on the slider value)
      const thickness = Math.max(1, Math.floor((options?.borderSize ?? borderSize) / 8));
      
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
      tempCtx.fillStyle = options?.borderColor ?? borderColor;
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
      ctx.fillStyle = options?.color ?? backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (option === 'blur') {
        // Step 1: Create and blur the background
        const bgCanvas = document.createElement('canvas');
        const bgCtx = bgCanvas.getContext('2d');
        if (!bgCtx) return;
        bgCanvas.width = canvas.width;
        bgCanvas.height = canvas.height;

        // Apply blur to the entire background
        bgCtx.filter = `blur(${options?.blur ?? blurIntensity}px)`;
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

  const handleBackgroundChange = useCallback(async (option: BackgroundOption, newOptions?: {
    color?: string;
    blur?: number;
    borderColor?: string;
    borderSize?: number;
  }) => {
    if (!originalImage || !processedImageNoBg) return;
    
    setBackgroundOption(option);
    
    if (option === 'none') {
      setProcessedImage(processedImageNoBg);
    } else {
      const newProcessedUrl = await applyBackgroundEffect(originalImage, processedImageNoBg, option, newOptions);
      if (newProcessedUrl) {
        setProcessedImage(newProcessedUrl);
      }
    }
  }, [originalImage, processedImageNoBg, applyBackgroundEffect]);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBackgroundColor(e.target.value);
    if (colorChangeTimeoutRef.current) {
      clearTimeout(colorChangeTimeoutRef.current);
    }
    colorChangeTimeoutRef.current = setTimeout(() => {
      if (backgroundOption === 'color') {
        handleBackgroundChange('color');
      }
    }, 150);
  };

  const handleBlurChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBlurIntensity(Number(e.target.value));
    if (backgroundOption === 'blur') {
      handleBackgroundChange('blur');
    }
  };

  const handleBorderColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBorderColor(e.target.value);
    if (borderChangeTimeoutRef.current) {
      clearTimeout(borderChangeTimeoutRef.current);
    }
    borderChangeTimeoutRef.current = setTimeout(() => {
      if (backgroundOption === 'border') {
        handleBackgroundChange('border');
      }
    }, 150);
  };

  const handleBorderSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBorderSize(Number(e.target.value));
    if (borderChangeTimeoutRef.current) {
      clearTimeout(borderChangeTimeoutRef.current);
    }
    borderChangeTimeoutRef.current = setTimeout(() => {
      if (backgroundOption === 'border') {
        handleBackgroundChange('border');
      }
    }, 150);
  };

  const handleSelectClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  return (
    <div className="min-h-screen py-16 px-4 bg-[#F8F9FB]">
      <main className="max-w-3xl mx-auto">
        <h1 className="text-[36px] font-bold mb-6 text-center tracking-tight">
          <span className="bg-gradient-to-r from-indigo-600 to-purple-500 text-transparent bg-clip-text">Remove  image backgrounds</span> in seconds
        </h1>
        <p className="text-center text-gray-600 mb-12 max-w-xl mx-auto">
          Remove backgrounds in one click. Add stylish filters, borders, and more with our editor—100% free, no sign-up required.
        </p>
        
        <div className="flex flex-col items-center gap-12">
          {!processedImage ? (
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
                      {isDragging ? 'Drop your image here' : 'Drag and drop your image here'}
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
          ) : null}

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
            <>
              <div className="flex flex-col items-center w-full">
                <div className="flex gap-3 flex-wrap justify-center mb-6">
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

                {/* Before/After Toggle */}
                <div className="flex justify-end w-full mb-2">
                  <div className="flex bg-[#F1F2F4] rounded-lg p-0.5">
                    <button
                      onClick={() => setShowOriginal(true)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                        showOriginal
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Before
                    </button>
                    <button
                      onClick={() => setShowOriginal(false)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                        !showOriginal
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      After
                    </button>
                  </div>
                </div>

                <div className="relative w-full rounded-2xl overflow-hidden ring-1 ring-black/[0.08]">
                  <div 
                    className={`absolute inset-0 ${
                      backgroundOption === 'none' && !showOriginal ? 
                      'bg-[linear-gradient(45deg,#F5F7FA_25%,transparent_25%,transparent_75%,#F5F7FA_75%,#F5F7FA),linear-gradient(45deg,#F5F7FA_25%,transparent_25%,transparent_75%,#F5F7FA_75%,#F5F7FA)] bg-[length:32px_32px] bg-[position:0_0,16px_16px] bg-white' 
                      : ''
                    }`}
                  />
                  <div className="relative w-full">
                    <Image
                      src={showOriginal ? originalImage! : processedImage}
                      alt={showOriginal ? "Original" : "Processed"}
                      width={0}
                      height={0}
                      sizes="100vw"
                      className="w-full h-auto"
                      style={{ 
                        backgroundColor: backgroundOption === 'none' && !showOriginal ? 'transparent' : '#F8F9FB'
                      }}
                      priority
                      unoptimized
                    />
                  </div>
                </div>

                <div className="fixed right-0 top-0 h-screen w-[320px] bg-white shadow-lg p-6 overflow-y-auto">
                  <div className="space-y-6">
                    {/* Background Section */}
                    <div>
                      <h3 className="text-[16px] font-semibold mb-4">Background</h3>
                      <div className="flex flex-wrap gap-3">
                        {[
                          { 
                            id: 'transparent',
                            type: 'transparent',
                            label: 'Transparent'
                          },
                          { 
                            id: 'white',
                            type: 'color',
                            color: '#FFFFFF',
                            border: true
                          },
                          { 
                            id: 'black',
                            type: 'color',
                            color: '#000000'
                          },
                          { 
                            id: 'brown',
                            type: 'color',
                            color: '#8B4513'
                          },
                          { 
                            id: 'navy',
                            type: 'color',
                            color: '#000080'
                          },
                          { 
                            id: 'peach',
                            type: 'color',
                            color: '#FFDAB9'
                          },
                          {
                            id: 'custom',
                            type: 'picker'
                          }
                        ].map((item) => (
                          <button
                            key={item.id}
                            onClick={async () => {
                              if (item.type === 'picker') {
                                const input = document.createElement('input');
                                input.type = 'color';
                                input.value = backgroundColor;
                                input.addEventListener('change', async (e) => {
                                  const target = e.target as HTMLInputElement;
                                  setBackgroundColor(target.value);
                                  await handleBackgroundChange('color', { color: target.value });
                                });
                                input.click();
                              } else if (item.type === 'color') {
                                setBackgroundColor(item.color!);
                                await handleBackgroundChange('color', { color: item.color });
                              } else if (item.type === 'transparent') {
                                handleBackgroundChange('none');
                              }
                            }}
                            className={`w-10 h-10 rounded-full cursor-pointer transition-all relative
                              ${item.type === 'transparent' ? 'bg-[linear-gradient(45deg,#F3F4F6_25%,transparent_25%,transparent_75%,#F3F4F6_75%,#F3F4F6),linear-gradient(45deg,#F3F4F6_25%,transparent_25%,transparent_75%,#F3F4F6_75%,#F3F4F6)] bg-[length:12px_12px] bg-[position:0_0,6px_6px] bg-white border border-gray-200' : ''}
                              hover:scale-110
                              ${item.border ? 'border-2 border-gray-300' : ''}
                              ${(item.type === 'color' && backgroundColor === item.color && backgroundOption === 'color') || 
                                (item.type === 'transparent' && backgroundOption === 'none')
                                  ? 'ring-2 ring-offset-2 ring-[#4F46E5]' : ''}`}
                            style={{
                              background: item.type === 'color' ? item.color : 
                                        item.type === 'picker' ? 'linear-gradient(45deg, #FF0000, #00FF00, #0000FF)' : undefined
                            }}
                            aria-label={item.label || `Select ${item.color} background`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Shadow Section */}
                    <div>
                      <button 
                        onClick={() => handleBackgroundChange('border')}
                        className="flex items-center justify-between w-full text-left mb-4"
                      >
                        <h3 className="text-[16px] font-semibold">Shadow</h3>
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {backgroundOption === 'border' && (
                        <div className="space-y-4">
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-[14px] font-medium text-gray-700">Size</label>
                              <span className="text-[14px] text-gray-500">{borderSize}px</span>
                            </div>
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
                          <div>
                            <label className="text-[14px] font-medium text-gray-700 block mb-2">Color</label>
                            <div className="flex gap-2">
                              {['#FFFFFF', '#000000', '#4F46E5', '#FFC0CB', '#FFD700'].map((color) => (
                                <button
                                  key={color}
                                  onClick={async () => {
                                    setBorderColor(color);
                                    await handleBackgroundChange('border', { borderColor: color });
                                  }}
                                  className={`w-8 h-8 rounded-full cursor-pointer transition-all
                                    ${color === '#FFFFFF' ? 'border-2 border-gray-300' : ''}
                                    ${borderColor === color ? 'ring-2 ring-offset-2 ring-[#4F46E5]' : ''}
                                    hover:scale-110`}
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                              <button
                                onClick={() => {
                                  const input = document.createElement('input');
                                  input.type = 'color';
                                  input.value = borderColor;
                                  input.addEventListener('change', async (e) => {
                                    const target = e.target as HTMLInputElement;
                                    setBorderColor(target.value);
                                    await handleBackgroundChange('border', { borderColor: target.value });
                                  });
                                  input.click();
                                }}
                                className="w-8 h-8 rounded-full cursor-pointer transition-all hover:scale-110"
                                style={{ background: 'linear-gradient(45deg, #FF0000, #00FF00, #0000FF)' }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Blur Section */}
                    <div>
                      <button 
                        onClick={() => handleBackgroundChange('blur')}
                        className="flex items-center justify-between w-full text-left mb-4"
                      >
                        <h3 className="text-[16px] font-semibold">Blur</h3>
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {backgroundOption === 'blur' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-[14px] font-medium text-gray-700">Intensity</label>
                            <span className="text-[14px] text-gray-500">{blurIntensity}px</span>
                          </div>
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
                    </div>

                    {/* B&W Section */}
                    <div>
                      <button 
                        onClick={() => handleBackgroundChange('bw')}
                        className="flex items-center justify-between w-full text-left"
                      >
                        <h3 className="text-[16px] font-semibold">Black & White</h3>
                        <div className={`w-6 h-6 rounded-sm transition-opacity ${backgroundOption === 'bw' ? 'opacity-100' : 'opacity-0'}`}>
                          <svg className="text-[#4F46E5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                <a
                  href={processedImage}
                  download="processed-image.png"
                  className="mt-6 px-6 py-2.5 bg-[#4F46E5] text-[14px] font-medium text-white rounded-md hover:bg-[#4338CA] transition-colors"
                >
                  Download
                </a>
              </div>
            </>
          )}
        </div>
      </main>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
