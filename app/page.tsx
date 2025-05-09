'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';

type ColorOption = {
  id: string;
  type: 'color' | 'transparent' | 'effect' | 'picker' | 'original';
  label: string;
  color?: string;
  border?: boolean;
  icon?: string;
  onClick?: () => void;
};

type EffectType = 'background' | 'border' | 'blur' | 'bw';

type Effect = {
  type: EffectType;
  enabled: boolean;
  options?: {
    color?: string;
    blur?: number;
    borderColor?: string;
    borderSize?: number;
    useOriginal?: boolean;
  };
};

type Effects = {
  background: Effect;
  border: Effect;
  blur: Effect;
  bw: Effect;
};

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [processedImageNoBg, setProcessedImageNoBg] = useState<string | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [effects, setEffects] = useState<Effects>({
    background: { type: 'background', enabled: false, options: { color: '#ffffff' } },
    border: { type: 'border', enabled: false, options: { borderColor: '#FFD700', borderSize: 40 } },
    blur: { type: 'blur', enabled: false, options: { blur: 10 } },
    bw: { type: 'bw', enabled: false }
  });
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [blurIntensity, setBlurIntensity] = useState(10);
  const [borderSize, setBorderSize] = useState(40);
  const [borderColor, setBorderColor] = useState('#FFD700');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const colorChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const borderChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isCustomBackground, setIsCustomBackground] = useState(false);
  const [isCustomBorder, setIsCustomBorder] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    // Initialize worker
    workerRef.current = new Worker(new URL('./worker.ts', import.meta.url));
    
    // Handle worker messages
    workerRef.current.onmessage = (e) => {
      const { type, progress, success, blob, error } = e.data;
      
      if (type === 'progress') {
        setProcessingProgress(progress);
        if (progress < 15) {
          setProcessingStep('Loading image...');
        } else if (progress < 30) {
          setProcessingStep('Preparing image...');
        } else if (progress < 50) {
          setProcessingStep('Analyzing image...');
        } else if (progress < 80) {
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

    // Store refs in variables for cleanup
    const worker = workerRef.current;
    const colorTimeout = colorChangeTimeoutRef.current;
    const borderTimeout = borderChangeTimeoutRef.current;

    // Cleanup worker and timeouts on unmount
    return () => {
      worker?.terminate();
      if (colorTimeout) {
        clearTimeout(colorTimeout);
      }
      if (borderTimeout) {
        clearTimeout(borderTimeout);
      }
    };
  }, []);

  const applyBackgroundEffect = useCallback(async (
    originalUrl: string, 
    foregroundUrl: string,
    currentEffects: Effects
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

    // Draw checkerboard pattern for transparent background if no background effect is enabled
    if (!currentEffects.background.enabled) {
      const size = 32; // Size of each square
      for (let x = 0; x < canvas.width; x += size) {
        for (let y = 0; y < canvas.height; y += size) {
          ctx.fillStyle = (x + y) % (size * 2) === 0 ? '#FFFFFF' : '#F5F7FA';
          ctx.fillRect(x, y, size, size);
        }
      }
    } else if (currentEffects.background.options?.useOriginal) {
      // Draw original image as background
      ctx.drawImage(originalImg, 0, 0);
    } else {
      // Fill with background color
      ctx.fillStyle = currentEffects.background.options?.color ?? '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Apply blur effect if enabled
    if (currentEffects.blur.enabled) {
      const bgCanvas = document.createElement('canvas');
      const bgCtx = bgCanvas.getContext('2d');
      if (bgCtx) {
        bgCanvas.width = canvas.width;
        bgCanvas.height = canvas.height;
        
        // First, draw the current canvas state (background) to the temporary canvas
        bgCtx.drawImage(canvas, 0, 0);
        
        // Apply blur to the background
        ctx.filter = `blur(${currentEffects.blur.options?.blur ?? 10}px)`;
        ctx.drawImage(bgCanvas, 0, 0);
        ctx.filter = 'none';
        
        // Clear the temporary canvas
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        
        // Draw the foreground onto the temporary canvas
        bgCtx.drawImage(foregroundImg, 0, 0);
        
        // Use the foreground as a mask
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(bgCanvas, 0, 0);
        
        // Reset composite operation and draw the foreground
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // Apply black & white effect if enabled
    if (currentEffects.bw.enabled) {
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

    // Draw the foreground image
    ctx.drawImage(foregroundImg, 0, 0);

    // Apply border effect if enabled
    if (currentEffects.border.enabled) {
      const borderSize = currentEffects.border.options?.borderSize ?? 40;
      const borderColor = currentEffects.border.options?.borderColor ?? '#ffffff';
      
      // Create temporary canvas for the border effect
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      // Calculate border thickness
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

      // Fill with border color
      tempCtx.fillStyle = borderColor;
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      // Use the mask to cut out the border shape
      tempCtx.globalCompositeOperation = 'destination-in';
      tempCtx.drawImage(maskCanvas, 0, 0);

      // Draw the border on the main canvas
      ctx.drawImage(
        tempCanvas, 
        -thickness, 
        -thickness, 
        tempCanvas.width, 
        tempCanvas.height
      );

      // Draw the foreground image again on top
      ctx.drawImage(foregroundImg, 0, 0);
    }

    // Convert to blob and create URL
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
      }, 'image/png');
    });
    return URL.createObjectURL(blob);
  }, []);

  const handleEffectChange = useCallback(async (effectType: keyof Effects, enabled: boolean, options?: Effect['options']) => {
    if (!originalImage || !processedImageNoBg) return;
    
    setEffects(prev => ({
      ...prev,
      [effectType]: {
        ...prev[effectType],
        enabled,
        options: {
          ...prev[effectType].options,
          ...options,
          // Set default yellow color when enabling border
          ...(effectType === 'border' && enabled && !options?.borderColor && { borderColor: '#FFD700' })
        }
      }
    }));
    
    const newProcessedUrl = await applyBackgroundEffect(originalImage, processedImageNoBg, {
      ...effects,
      [effectType]: {
        ...effects[effectType],
        enabled,
        options: {
          ...effects[effectType].options,
          ...options,
          // Set default yellow color when enabling border
          ...(effectType === 'border' && enabled && !options?.borderColor && { borderColor: '#FFD700' })
        }
      }
    });
    
    if (newProcessedUrl) {
      setProcessedImage(newProcessedUrl);
    }
  }, [originalImage, processedImageNoBg, effects, applyBackgroundEffect]);

  const handleBlurChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBlur = Number(e.target.value);
    setBlurIntensity(newBlur);
    handleEffectChange('blur', true, { blur: newBlur });
  };

  const handleBorderSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSize = Number(e.target.value);
    setBorderSize(newSize);
    if (borderChangeTimeoutRef.current) {
      clearTimeout(borderChangeTimeoutRef.current);
    }
    borderChangeTimeoutRef.current = setTimeout(() => {
      handleEffectChange('border', true, { borderSize: newSize });
    }, 150);
  };

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

    // Store original filename
    setOriginalFilename(file.name);

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

    // Store original filename
    setOriginalFilename(file.name);

    // Create URL for the original image
    const imageUrl = URL.createObjectURL(file);
    setOriginalImage(imageUrl);
    setProcessedImage(null);
    setProcessedImageNoBg(null);
    setIsProcessing(true);

    // Send image to worker for processing
    workerRef.current?.postMessage({ imageUrl });
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
          Erase backgrounds from images. Add stylish filters, borders, and more with our editor. 100% free, no sign-up required.
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
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3 overflow-hidden">
                <div 
                  className="bg-[#4F46E5] h-2 rounded-full transition-all duration-300 animate-pulse" 
                  style={{ width: `${processingProgress}%` }}
                ></div>
              </div>
              <p className="text-[14px] text-gray-600">{processingProgress}% complete</p>
            </div>
          )}

          {processedImage && (
            <>
              <div className="flex flex-col items-center w-full">
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
                      !effects.background.enabled ? 
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
                        backgroundColor: !effects.background.enabled && !showOriginal ? 'transparent' : '#F8F9FB'
                      }}
          priority
                      unoptimized
                    />
                  </div>
                </div>

                {/* Mobile Menu Overlay */}
                <div className={`fixed inset-0 bg-gray-300/30 z-40 md:hidden ${isMenuOpen ? 'block' : 'hidden'}`}
                     onClick={() => setIsMenuOpen(false)}>
                </div>

                {/* Sidebar Menu */}
                <div className={`fixed right-0 top-0 h-screen w-[320px] bg-white shadow-lg overflow-y-auto z-50 transition-transform duration-300 ease-in-out
                               ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'} md:translate-x-0 md:fixed md:right-0 md:top-0 md:h-screen md:w-[320px] md:mt-0`}>
                  <div className="p-4">
                    <div className="flex justify-between items-center mb-4 md:hidden">
                      <h2 className="text-lg font-semibold text-gray-900">Editor</h2>
                      <button
                        onClick={() => setIsMenuOpen(false)}
                        className="px-4 py-2 text-[#4F46E5] border border-[#4F46E5] rounded-md hover:bg-[#F5F7FF] transition-colors"
                      >
                        Close Editor
                      </button>
                    </div>
                    {/* Background Section */}
                    <div className="border-b border-gray-300">
                      <div className="py-4">
                        <h3 className="text-[16px] font-semibold text-gray-900">Background</h3>
                        <div className="mt-4 flex flex-wrap gap-3">
                          {([
                            { 
                              id: 'transparent',
                              type: 'transparent' as const,
                              label: 'Transparent'
                            },
                            { 
                              id: 'original',
                              type: 'original' as const,
                              label: 'Original Background'
                            },
                            { 
                              id: 'white',
                              type: 'color' as const,
                              label: 'White',
                              color: '#FFFFFF',
                              border: true
                            },
                            { 
                              id: 'black',
                              type: 'color' as const,
                              label: 'Black',
                              color: '#000000'
                            },
                            { 
                              id: 'brown',
                              type: 'color' as const,
                              label: 'Brown',
                              color: '#8B4513'
                            },
                            { 
                              id: 'navy',
                              type: 'color' as const,
                              label: 'Navy',
                              color: '#000080'
                            },
                            { 
                              id: 'peach',
                              type: 'color' as const,
                              label: 'Peach',
                              color: '#FFDAB9'
                            },
                            {
                              id: 'custom',
                              type: 'picker' as const,
                              label: 'Custom Color'
                            }
                          ] satisfies ColorOption[]).map((item) => (
                            <button
                              key={item.id}
                              onClick={async (e) => {
                                if (item.type === 'picker') {
                                  const button = e.currentTarget;
                                  const rect = button.getBoundingClientRect();
                                  
                                  const input = document.createElement('input');
                                  input.type = 'color';
                                  input.value = backgroundColor;
                                  
                                  // Position and style the input directly
                                  input.style.cssText = `
                                    position: fixed;
                                    left: ${rect.left - 10}px;
                                    top: ${rect.top - 10}px;
                                    opacity: 0;
                                    z-index: 9999;
                                    width: 60px;
                                    height: 60px;
                                    padding: 0;
                                    border: none;
                                    border-radius: 8px;
                                    cursor: pointer;
                                  `;
                                  
                                  document.body.appendChild(input);
                                  
                                  // Wait for the next frame to ensure positioning is applied
                                  requestAnimationFrame(() => {
                                    input.click();
                                  });
                                  
                                  input.addEventListener('change', async (e) => {
                                    const target = e.target as HTMLInputElement;
                                    setBackgroundColor(target.value);
                                    setIsCustomBackground(true);
                                    await handleEffectChange('background', true, { color: target.value, useOriginal: false });
                                    if (document.body.contains(input)) {
                                      document.body.removeChild(input);
                                    }
                                  });
                                  
                                  input.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                  });
                                  
                                  // Clean up if they click away
                                  const handleClickOutside = (e: MouseEvent) => {
                                    if (e.target !== input && document.body.contains(input)) {
                                      document.body.removeChild(input);
                                      document.removeEventListener('click', handleClickOutside);
                                    }
                                  };
                                  
                                  setTimeout(() => {
                                    document.addEventListener('click', handleClickOutside);
                                  }, 100);
                                } else if (item.type === 'color') {
                                  setBackgroundColor(item.color!);
                                  setIsCustomBackground(false);
                                  await handleEffectChange('background', true, { color: item.color, useOriginal: false });
                                } else if (item.type === 'transparent') {
                                  setIsCustomBackground(false);
                                  handleEffectChange('background', false);
                                } else if (item.type === 'original') {
                                  setIsCustomBackground(false);
                                  await handleEffectChange('background', true, { useOriginal: true });
                                }
                              }}
                              className={`w-10 h-10 rounded-full cursor-pointer transition-all relative
                                ${item.type === 'transparent' ? 'bg-[linear-gradient(45deg,#F3F4F6_25%,transparent_25%,transparent_75%,#F3F4F6_75%,#F3F4F6),linear-gradient(45deg,#F3F4F6_25%,transparent_25%,transparent_75%,#F3F4F6_75%,#F3F4F6)] bg-[length:12px_12px] bg-[position:0_0,6px_6px] bg-white border border-gray-200' : ''}
                                ${item.type === 'original' ? 'overflow-hidden border border-gray-200' : ''}
                                hover:scale-110
                                ${item.border ? 'border-2 border-gray-300' : ''}
                                ${((item.type === 'color' && backgroundColor === item.color && effects.background.enabled && !effects.background.options?.useOriginal) || 
                                  (item.type === 'transparent' && !effects.background.enabled) ||
                                  (item.type === 'original' && effects.background.enabled && effects.background.options?.useOriginal) ||
                                  (item.type === 'picker' && isCustomBackground && effects.background.enabled))
                                    ? 'ring-2 ring-offset-2 ring-[#4F46E5]' : ''}`}
                              style={{
                                background: item.type === 'color' ? item.color : 
                                          item.type === 'picker' ? 'linear-gradient(45deg, #FF0000, #00FF00, #0000FF)' :
                                          item.type === 'original' && originalImage ? `url(${originalImage})` : undefined,
                                backgroundSize: item.type === 'original' ? 'cover' : undefined,
                                backgroundPosition: item.type === 'original' ? 'center' : undefined,
                              }}
                              aria-label={item.label || `Select ${item.color} background`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Shadow Section */}
                    <div className="border-b border-gray-300">
                      <div className="py-4">
                        <button 
                          onClick={() => handleEffectChange('border', !effects.border.enabled)}
                          className="flex items-center justify-between w-full text-left"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-[16px] font-semibold text-gray-900">Outline</h3>
                            <div className={`w-6 h-6 rounded-sm transition-opacity ${effects.border.enabled ? 'opacity-100' : 'opacity-0'}`}>
                              <svg className="text-[#4F46E5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                        </button>
                        {effects.border.enabled && (
                          <div className="mt-4 space-y-4">
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
                                      setIsCustomBorder(false);
                                      await handleEffectChange('border', true, { borderColor: color });
                                    }}
                                    className={`w-8 h-8 rounded-full cursor-pointer transition-all
                                      ${color === '#FFFFFF' ? 'border-2 border-gray-300' : ''}
                                      ${borderColor === color ? 'ring-2 ring-offset-2 ring-[#4F46E5]' : ''}
                                      hover:scale-110`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                                <button
                                  onClick={(e) => {
                                    const button = e.currentTarget;
                                    const rect = button.getBoundingClientRect();
                                    
                                    const input = document.createElement('input');
                                    input.type = 'color';
                                    input.value = borderColor;
                                    
                                    // Position and style the input directly
                                    input.style.cssText = `
                                      position: fixed;
                                      left: ${rect.left - 10}px;
                                      top: ${rect.top - 10}px;
                                      opacity: 0;
                                      z-index: 9999;
                                      width: 60px;
                                      height: 60px;
                                      padding: 0;
                                      border: none;
                                      border-radius: 8px;
                                      cursor: pointer;
                                    `;
                                    
                                    document.body.appendChild(input);
                                    
                                    // Wait for the next frame to ensure positioning is applied
                                    requestAnimationFrame(() => {
                                      input.click();
                                    });
                                    
                                    input.addEventListener('change', async (e) => {
                                      const target = e.target as HTMLInputElement;
                                      setBorderColor(target.value);
                                      setIsCustomBorder(true);
                                      await handleEffectChange('border', true, { borderColor: target.value });
                                      if (document.body.contains(input)) {
                                        document.body.removeChild(input);
                                      }
                                    });
                                    
                                    input.addEventListener('click', (e) => {
                                      e.stopPropagation();
                                    });
                                    
                                    // Clean up if they click away
                                    const handleClickOutside = (e: MouseEvent) => {
                                      if (e.target !== input && document.body.contains(input)) {
                                        document.body.removeChild(input);
                                        document.removeEventListener('click', handleClickOutside);
                                      }
                                    };
                                    
                                    setTimeout(() => {
                                      document.addEventListener('click', handleClickOutside);
                                    }, 100);
                                  }}
                                  className={`w-8 h-8 rounded-full cursor-pointer transition-all hover:scale-110 ${
                                    isCustomBorder ? 'ring-2 ring-offset-2 ring-[#4F46E5]' : ''
                                  }`}
                                  style={{ background: 'linear-gradient(45deg, #FF0000, #00FF00, #0000FF)' }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Blur Section */}
                    <div className="border-b border-gray-300">
                      <div className="py-4">
                        <button 
                          onClick={() => handleEffectChange('blur', !effects.blur.enabled)}
                          className="flex items-center justify-between w-full text-left"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-[16px] font-semibold text-gray-900">Blur</h3>
                            <div className={`w-6 h-6 rounded-sm transition-opacity ${effects.blur.enabled ? 'opacity-100' : 'opacity-0'}`}>
                              <svg className="text-[#4F46E5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                        </button>
                        {effects.blur.enabled && (
                          <div className="mt-4">
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
                    </div>

                    {/* B&W Section */}
                    <div>
                      <div className="py-4">
                        <button 
                          onClick={() => handleEffectChange('bw', !effects.bw.enabled)}
                          className="flex items-center justify-between w-full text-left"
                        >
                          <div className="flex items-center gap-2">
                            <h3 className="text-[16px] font-semibold text-gray-900">Black & White</h3>
                            <div className={`w-6 h-6 rounded-sm transition-opacity ${effects.bw.enabled ? 'opacity-100' : 'opacity-0'}`}>
                              <svg className="text-[#4F46E5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setIsMenuOpen(true)}
                    className="px-4 py-2.5 bg-white text-[#4F46E5] border border-[#4F46E5] text-[14px] font-medium rounded-md hover:bg-[#F5F7FF] transition-colors md:hidden flex items-center gap-1.5"
                  >
                    Open Editor
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <a
                    href={processedImage}
                    download={originalFilename ? `${originalFilename.split('.')[0]}_removeimagebg.png` : 'processed-image.png'}
                    className="px-6 py-2.5 bg-[#4F46E5] text-[14px] font-medium text-white rounded-md hover:bg-[#4338CA] transition-colors"
                  >
                    Download
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
