import React, { useEffect, useRef, useState } from 'react';
import { ApiKeyScreen } from './components/ApiKeyScreen';
import { GeminiService } from './services/geminiService';
import { StickerStyle, StickerSheetConfig } from './types';
import {
  composeStickerSheet,
  processTransparentSheet,
  splitStickerSheet,
} from './utils/imageProcessor';

type ProcessingStep = 'idle' | 'analyzing' | 'generating' | 'removing' | 'complete';

const STICKER_COLUMNS = 4;
const STICKER_ROWS = 4;
const TOTAL_STICKERS = STICKER_COLUMNS * STICKER_ROWS;

interface StickerSlot {
  id: string;
  url: string;
  locked: boolean;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const App: React.FC = () => {
  const [showKeyScreen, setShowKeyScreen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingStep, setProcessingStep] = useState<ProcessingStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transparentImageUrl, setTransparentImageUrl] = useState<string | null>(null);
  const [stickerSlots, setStickerSlots] = useState<StickerSlot[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [simulatedStickerCount, setSimulatedStickerCount] = useState(1);
  const [generationTargetCount, setGenerationTargetCount] = useState(TOTAL_STICKERS);
  const [isComplianceChecking, setIsComplianceChecking] = useState(false);

  const [config, setConfig] = useState<StickerSheetConfig>({
    base64Image: '',
    size: '1K',
    aspectRatio: '1:1',
    extraPrompt: '',
    style: 'Pixar 3D',
    includeCaptions: true,
  });

  const geminiServiceRef = useRef<GeminiService>(new GeminiService());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      if ((window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        setShowKeyScreen(!hasKey);
      } else {
        setShowKeyScreen(false);
      }
    };

    checkApiKey();

    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setSimulatedStickerCount(1);
      setIsComplianceChecking(false);
      return;
    }

    if (processingStep === 'analyzing') {
      setSimulatedStickerCount(1);
      setIsComplianceChecking(false);
      return;
    }

    if (processingStep === 'removing') {
      setSimulatedStickerCount(generationTargetCount);
      setIsComplianceChecking(true);
      return;
    }

    if (processingStep !== 'generating') return;

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const nextCount = Math.min(generationTargetCount, Math.max(1, Math.floor(elapsedSeconds * 1.35) + 1));
      setSimulatedStickerCount(nextCount);
      setIsComplianceChecking(Math.floor(elapsedSeconds / 2.2) % 2 === 1);
    }, 650);

    return () => window.clearInterval(interval);
  }, [loading, processingStep, generationTargetCount]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file only.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setConfig((prev) => ({ ...prev, base64Image: reader.result }));
        setHasGenerated(false);
        setTransparentImageUrl(null);
        setStickerSlots([]);
        setGenerationTargetCount(TOTAL_STICKERS);
        setError(null);
      }
    };

    reader.readAsDataURL(file);
  };

  const openImagePicker = () => {
    fileInputRef.current?.click();
  };

  const generateSheet = async () => {
    if (!isOnline) {
      setError('You are offline. Please connect to the internet and try again.');
      return;
    }

    if (!config.base64Image) {
      setError('Please upload a source image first.');
      return;
    }

    const canReuseExisting = stickerSlots.length === TOTAL_STICKERS;
    const unlockedCount = canReuseExisting
      ? stickerSlots.filter((slot) => !slot.locked).length
      : TOTAL_STICKERS;

    if (canReuseExisting && unlockedCount === 0) {
      setError('เลือกอย่างน้อย 1 สติ๊กเกอร์ที่ยังไม่ล็อกก่อนกด Regenerate');
      return;
    }

    setGenerationTargetCount(unlockedCount);
    setLoading(true);
    setProcessingStep('analyzing');
    setError(null);

    try {
      await wait(650);
      setProcessingStep('generating');
      const stickerSheetUrl = await geminiServiceRef.current.generateStickerSheet(config);

      setProcessingStep('removing');
      await wait(300);
      const processedUrl = await processTransparentSheet(stickerSheetUrl, true);
      const regeneratedStickers = await splitStickerSheet(processedUrl, STICKER_COLUMNS, STICKER_ROWS);

      if (regeneratedStickers.length < TOTAL_STICKERS) {
        throw new Error('Generated sheet is incomplete. Please try again.');
      }

      const now = Date.now();
      const mergedSlots: StickerSlot[] = canReuseExisting
        ? stickerSlots.map((slot, index) =>
            slot.locked
              ? slot
              : { ...slot, url: regeneratedStickers[index], id: `${now}-${index}` }
          )
        : regeneratedStickers.slice(0, TOTAL_STICKERS).map((url, index) => ({
            id: `${now}-${index}`,
            url,
            locked: false,
          }));

      const composedSheetUrl = await composeStickerSheet(
        mergedSlots.map((slot) => slot.url),
        STICKER_COLUMNS,
        STICKER_ROWS
      );

      setStickerSlots(mergedSlots);
      setTransparentImageUrl(composedSheetUrl);
      setHasGenerated(true);
      setProcessingStep('complete');

      setTimeout(() => {
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        resultRef.current?.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start',
        });
      }, 250);
    } catch (err: any) {
      setError(err.message || 'Failed to generate sticker set.');
      if (err.message?.includes('403') || err.message?.includes('500') || err.message?.includes('key')) {
        setTimeout(() => setShowKeyScreen(true), 1500);
      }
    } finally {
      setLoading(false);
      setProcessingStep('idle');
      setGenerationTargetCount(TOTAL_STICKERS);
    }
  };

  const toggleStickerLock = (index: number) => {
    setStickerSlots((prev) =>
      prev.map((slot, slotIndex) =>
        slotIndex === index
          ? { ...slot, locked: !slot.locked }
          : slot
      )
    );
    setError(null);
  };

  const handleDownload = () => {
    if (!transparentImageUrl) return;
    const link = document.createElement('a');
    link.href = transparentImageUrl;
    link.download = `line-sticker-sheet-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (showKeyScreen === null) {
    return <div className="min-h-dvh bg-[#f8fafc]" aria-hidden="true" />;
  }

  if (showKeyScreen) {
    return <ApiKeyScreen onKeySelected={() => setShowKeyScreen(false)} />;
  }

  const lockedCount = stickerSlots.filter((slot) => slot.locked).length;
  const unlockedCount = stickerSlots.length > 0 ? stickerSlots.length - lockedCount : TOTAL_STICKERS;
  const generateButtonLabel = loading
    ? 'Generating...'
    : hasGenerated
      ? lockedCount > 0
        ? `Regenerate Unchecked (${unlockedCount})`
        : 'Regenerate'
      : 'Generate';
  const runnerAvatarUrl = stickerSlots[0]?.url || config.base64Image;

  const loadingHeadline =
    processingStep === 'analyzing'
      ? 'กำลังเตรียมภาพต้นฉบับ'
      : processingStep === 'generating'
        ? `กำลังสร้างสติ๊กเกอร์ ${simulatedStickerCount}/${generationTargetCount}`
        : processingStep === 'removing'
          ? 'กำลังเตรียมไฟล์ PNG'
          : 'พร้อมใช้งาน';

  const loadingSubtext =
    processingStep === 'analyzing'
      ? 'กำลังจัดองค์ประกอบตัวละคร'
      : processingStep === 'generating'
        ? isComplianceChecking
          ? 'กำลังตรวจสอบกฎระเบียบของ LINE'
          : `กำลังเรนเดอร์สติ๊กเกอร์ ${simulatedStickerCount}/${generationTargetCount}`
        : processingStep === 'removing'
          ? 'กำลังตัดพื้นหลังสีเขียว'
          : 'Ready';

  const simulatedProgress =
    processingStep === 'analyzing'
      ? 12
      : processingStep === 'generating'
        ? 16 + Math.round((simulatedStickerCount / generationTargetCount) * 64)
        : processingStep === 'removing'
          ? 92
          : processingStep === 'complete'
            ? 100
            : 0;

  return (
    <div className="min-h-dvh bg-[#f8fafc] text-slate-900">
      <a href="#main-content" className="skip-link focus-ring">
        Skip to main content
      </a>

      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/80 px-4 py-4 backdrop-blur-[20px]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-4 sm:max-w-xl">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-600">Sticker Studio</p>
            <h1 className="text-2xl font-semibold leading-tight text-slate-900">Sticker Composer</h1>
          </div>

          <div
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
              isOnline ? 'bg-slate-100 text-slate-800' : 'bg-red-50 text-red-700'
            }`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-green-600' : 'bg-red-600'}`}
              aria-hidden="true"
            />
            <span>{isOnline ? 'Ready' : 'Offline'}</span>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6 sm:max-w-xl" aria-busy={loading}>
        <section className="rounded-[2.5rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="sr-only">
            Source photo
          </h2>

          <input
            id="source-image-input"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="sr-only"
          />

          <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-gradient-to-b from-white to-slate-100/70">
            <button
              type="button"
              onClick={openImagePicker}
              className="focus-ring relative block aspect-[4/5] w-full overflow-hidden sm:aspect-[4/3]"
              aria-label="Choose or capture source photo"
            >
              {config.base64Image ? (
                <img
                  src={config.base64Image}
                  alt="Uploaded source preview"
                  className={`h-full w-full object-cover ${loading ? 'opacity-60' : ''}`}
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-lg ring-1 ring-slate-200">
                    <svg className="h-11 w-11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </span>
                </span>
              )}
              <span className="sr-only">Open camera or photo library</span>
            </button>

            {!config.base64Image && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-2" aria-hidden="true">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      d="M4 8h3l2-2h6l2 2h3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                </span>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="4" y="5" width="16" height="14" rx="2" />
                    <path d="m8 13 2-2 4 4 2-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="9" cy="9" r="1.25" />
                  </svg>
                </span>
              </div>
            )}

            {config.base64Image && !loading && (
              <button
                type="button"
                onClick={openImagePicker}
                className="focus-ring absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm ring-1 ring-slate-200"
                aria-label="Replace source photo"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M4 8h3l2-2h6l2 2h3v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </button>
            )}

            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/45 backdrop-blur-[2px]" aria-hidden="true">
                <span className="h-10 w-10 animate-pulse rounded-full border-2 border-indigo-300 bg-white/70" />
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Controls</h2>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-slate-800">Style</legend>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['Chibi 2D', 'Pixar 3D'] as StickerStyle[]).map((style) => {
                const selected = config.style === style;
                return (
                  <label
                    key={style}
                    className={`min-h-11 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                      selected
                        ? 'border-indigo-700 bg-indigo-600 text-white'
                        : 'border-slate-300 bg-white text-slate-800 hover:border-indigo-400'
                    } flex cursor-pointer items-center gap-3`}
                  >
                    <input
                      type="radio"
                      name="sticker-style"
                      value={style}
                      checked={selected}
                      onChange={() => setConfig((prev) => ({ ...prev, style }))}
                      className="focus-ring h-4 w-4 border-slate-400 text-indigo-600"
                    />
                    {style}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5">
            <label htmlFor="prompt-details" className="text-sm font-medium text-slate-800">
              Prompt details
            </label>
            <textarea
              id="prompt-details"
              value={config.extraPrompt}
              onChange={(e) => setConfig((prev) => ({ ...prev, extraPrompt: e.target.value }))}
              className="focus-ring mt-2 min-h-32 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
              placeholder="Example: glasses, holding coffee cup, smiling confidently"
            />
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              id="include-captions"
              type="checkbox"
              checked={config.includeCaptions}
              onChange={(e) => setConfig((prev) => ({ ...prev, includeCaptions: e.target.checked }))}
              className="focus-ring mt-1 h-5 w-5 rounded border-slate-400 text-indigo-600"
            />
            <label htmlFor="include-captions" className="text-sm text-slate-800">
              Captions
            </label>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={generateSheet}
              disabled={
                loading
                || !config.base64Image
                || !isOnline
                || (hasGenerated && stickerSlots.length === TOTAL_STICKERS && lockedCount === TOTAL_STICKERS)
              }
              aria-describedby="generate-helper"
              className="focus-ring min-h-11 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {generateButtonLabel}
            </button>

            <p id="generate-helper" className="text-sm text-slate-700" role="status" aria-live="polite">
              {loading
                ? loadingHeadline
                : hasGenerated && lockedCount === TOTAL_STICKERS
                  ? 'ปลดล็อกอย่างน้อย 1 รูปเพื่อ Regenerate'
                  : hasGenerated
                    ? `ล็อกแล้ว ${lockedCount}/${TOTAL_STICKERS} รูป`
                    : 'Ready'}
            </p>
          </div>

          {loading && config.base64Image && (
            <div className="mt-4 rounded-3xl border border-indigo-100 bg-indigo-50/70 p-4" role="status" aria-live="polite" aria-atomic="true">
              <div className="loading-runner-track">
                <div className="loading-runner-lane" />
                <div className="loading-runner-avatar">
                  <div className="loading-runner-sticker-shell">
                    <img src={runnerAvatarUrl} alt="" className="loading-runner-sticker-image" />
                  </div>
                  <span className="loading-runner-wheel loading-runner-wheel-left" />
                  <span className="loading-runner-wheel loading-runner-wheel-right" />
                </div>
                <span className="loading-runner-speed loading-runner-speed-a" />
                <span className="loading-runner-speed loading-runner-speed-b" />
                <span className="loading-runner-speed loading-runner-speed-c" />
              </div>

              <p className="mt-3 text-sm font-semibold text-slate-900">{loadingHeadline}</p>
              <p className="text-xs text-slate-700">{loadingSubtext}</p>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100">
                <span
                  className="block h-full rounded-full bg-indigo-600 transition-all duration-500"
                  style={{ width: `${simulatedProgress}%` }}
                />
              </div>

              <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
                <li className="flex items-center gap-2">
                  <span className="text-base" aria-hidden="true">
                    {processingStep === 'analyzing' ? '🔄' : '✅'}
                  </span>
                  <span>วิเคราะห์ภาพต้นฉบับ</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-base" aria-hidden="true">
                    {processingStep === 'generating' && !isComplianceChecking ? '🎨' : processingStep === 'removing' || processingStep === 'complete' ? '✅' : '⏳'}
                  </span>
                  <span>{`กำลังสร้างสติ๊กเกอร์ ${simulatedStickerCount}/${generationTargetCount}`}</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-base" aria-hidden="true">
                    {processingStep === 'generating' && isComplianceChecking ? '🛡️' : processingStep === 'removing' || processingStep === 'complete' ? '✅' : '⏳'}
                  </span>
                  <span>กำลังตรวจสอบกฎระเบียบของ LINE</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-base" aria-hidden="true">
                    {processingStep === 'removing' ? '📦' : processingStep === 'complete' ? '✅' : '⏳'}
                  </span>
                  <span>กำลังเตรียมไฟล์ PNG</span>
                </li>
              </ul>
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        {transparentImageUrl && (
          <section
            ref={resultRef}
            className="rounded-[2.5rem] border border-slate-200 bg-white p-6 shadow-sm"
            aria-labelledby="preview-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="preview-heading" className="text-lg font-semibold text-slate-900">
                Preview
              </h2>
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">PNG ready</span>
            </div>

            {stickerSlots.length === TOTAL_STICKERS && (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-700">ติ๊กถูกที่สติ๊กเกอร์ที่ต้องการเก็บไว้ก่อนกด Regenerate</p>
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                    Locked {lockedCount}/{TOTAL_STICKERS}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-3">
                  {stickerSlots.map((slot, index) => (
                    <label
                      key={slot.id}
                      className={`relative block overflow-hidden rounded-2xl border bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgHQAmUPwdICYAOIyDPr5CABdamAivXkrFgAAAABJRU5ErkJggg==')] bg-repeat p-1.5 ${
                        slot.locked ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={slot.locked}
                        onChange={() => toggleStickerLock(index)}
                        disabled={loading}
                        className="focus-ring absolute left-2 top-2 z-10 h-5 w-5 rounded border-slate-300 bg-white text-indigo-600 shadow"
                        aria-label={`Lock sticker ${index + 1}`}
                      />
                      <img
                        src={slot.url}
                        alt={`Sticker ${index + 1}`}
                        className="aspect-square w-full rounded-xl bg-white object-contain"
                      />
                      <span
                        className={`pointer-events-none absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          slot.locked ? 'bg-indigo-600 text-white' : 'bg-white/90 text-slate-700'
                        }`}
                      >
                        {slot.locked ? 'เก็บไว้' : `#${index + 1}`}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="mt-5 overflow-hidden rounded-[2rem] border border-slate-200 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgHQAmUPwdICYAOIyDPr5CABdamAivXkrFgAAAABJRU5ErkJggg==')] bg-repeat p-2">
              <img
                src={transparentImageUrl}
                alt="Generated transparent sticker sheet preview"
                className="aspect-square w-full rounded-[1.5rem] bg-white object-contain"
              />
            </div>

            <button
              type="button"
              onClick={handleDownload}
              className="focus-ring mt-4 min-h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:border-indigo-500 hover:text-indigo-700"
            >
              Download PNG
            </button>
          </section>
        )}

      </main>
    </div>
  );
};

export default App;
