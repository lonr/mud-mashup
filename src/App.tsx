import { useRef, useState, useEffect } from 'react';
import { lyrics, title, artist, sample } from './lyricsWithTimestamps.json';

// Add these types and audio context setup
interface AudioContextState {
  context: AudioContext | null;
  buffer: AudioBuffer | null;
  currentSource: AudioBufferSourceNode | null;
}

const lyricsMap = new Map<string, number[]>();
lyrics.forEach((item, index) => {
  if (!lyricsMap.has(item.lyric)) {
    lyricsMap.set(item.lyric, []);
  }
  lyricsMap.get(item.lyric)!.push(index);
});

// Helper functions for URL sharing
const encodeSelectedLyrics = (selected: number[]): string => {
  return selected.join(',');
};

const decodeSelectedLyrics = (encoded: string): number[] | null => {
  try {
    return encoded
      .split(',')
      .map(Number)
      .filter((n) => !isNaN(n));
  } catch {
    return null;
  }
};

function App() {
  const [selected, setSelected] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const hasInitialized = useRef(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Add refs for latest state
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const currentIndexRef = useRef(0);

  // State for music player UI
  const [currentLyricIdx, setCurrentLyricIdx] = useState<number | null>(null);
  const [isRepeatMode, setIsRepeatMode] = useState(false);
  const lyricRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // Track if we're loading from URL to prevent unwanted scrolling
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState(false);

  // Load shared lyrics and emoji state from URL on component mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const urlParams = new URLSearchParams(window.location.search);
    const sharedLyrics = urlParams.get('lyrics');
    const emojiParam = urlParams.get('emoji');

    if (emojiParam === '1') setShowEmoji(true);
    if (emojiParam === '0') setShowEmoji(false);

    if (sharedLyrics) {
      const decoded = decodeSelectedLyrics(sharedLyrics);
      if (decoded && decoded.length > 0) {
        setIsLoadingFromUrl(true);
        setSelected(decoded);
        setTimeout(() => setIsLoadingFromUrl(false), 200);
        return;
      }
    }
    setSelected(sample);
  }, []);

  // Update URL when selected lyrics or showEmoji change (but not during initial load)
  useEffect(() => {
    if (!hasInitialized.current) return;
    if (!isLoadingFromUrl && (selected.length > 0 || showEmoji !== false)) {
      const encodedLyrics = encodeSelectedLyrics(selected);
      const emojiParam = showEmoji ? '1' : '0';
      const newUrl = `${window.location.pathname}?emoji=${emojiParam}&lyrics=${encodedLyrics}`;
      window.history.replaceState({}, '', newUrl);
    } else if (!isLoadingFromUrl && selected.length === 0 && showEmoji === false) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [selected, isLoadingFromUrl, showEmoji]);

  // Keep repeat mode in a ref to always get latest value in async callbacks
  const isRepeatModeRef = useRef(isRepeatMode);
  useEffect(() => {
    isRepeatModeRef.current = isRepeatMode;
  }, [isRepeatMode]);

  // Effect to update ref when isPlaying changes
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Scroll current lyric into center when playing
  useEffect(() => {
    if (!isPlaying || currentLyricIdx == null) return;
    const el = lyricRefs.current[currentLyricIdx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentLyricIdx, isPlaying]);

  // Scroll to last lyric when editing (not playing)
  useEffect(() => {
    if (!isEditing || isPlaying || selected.length === 0 || isLoadingFromUrl) return;
    const lastLyricIdx = selected.length - 1;
    const el = lyricRefs.current[lastLyricIdx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selected, isEditing, isPlaying, isLoadingFromUrl]);

  // Initialize Web Audio API
  const audioContextRef = useRef<AudioContextState>({
    context: null,
    buffer: null,
    currentSource: null,
  });

  useEffect(() => {
    const initAudio = async () => {
      try {
        const context = new (window.AudioContext || (window as any).webkitAudioContext)();
        const response = await fetch(`${import.meta.env.BASE_URL}example.mp3`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(arrayBuffer);

        audioContextRef.current = {
          context,
          buffer,
          currentSource: null,
        };
      } catch (error) {
        console.error('Failed to initialize audio:', error);
      }
    };

    initAudio();

    return () => {
      if (audioContextRef.current.context) {
        audioContextRef.current.context.close();
      }
    };
  }, []);

  // Play audio segment using Web Audio API
  const playAudioSegment = (startTime: number, duration: number) => {
    const { context, buffer } = audioContextRef.current;
    if (!context || !buffer) return;

    // Stop any currently playing audio
    if (audioContextRef.current.currentSource) {
      audioContextRef.current.currentSource.stop();
    }

    // Create new source
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startSec = startTime / 1000;
    const durationSec = duration / 1000;

    // Play segment
    source.start(0, startSec, durationSec);
    audioContextRef.current.currentSource = source;

    // Auto-stop after duration
    source.onended = () => {
      audioContextRef.current.currentSource = null;
    };
  };

  const stopAudio = () => {
    if (audioContextRef.current.currentSource) {
      audioContextRef.current.currentSource.stop();
      audioContextRef.current.currentSource = null;
    }
  };

  const addLyric = (lyricText: string) => {
    const instances = lyricsMap.get(lyricText)!;
    let chosenIndex: number;
    if (instances.length === 1) {
      chosenIndex = instances[0];
    } else if (selected.length === 0) {
      chosenIndex = instances[0];
    } else {
      const lastSelectedIndex = selected[selected.length - 1];
      const lastBeatPosition = lyrics[lastSelectedIndex].endBeat;
      let bestInstanceIndex = instances[0];
      let minBeatDiff = Infinity;
      for (const instanceIndex of instances) {
        const beatDiff = Math.abs(lyrics[instanceIndex].startBeat - lastBeatPosition);
        if (beatDiff < minBeatDiff) {
          minBeatDiff = beatDiff;
          bestInstanceIndex = instanceIndex;
        }
      }
      chosenIndex = bestInstanceIndex;
    }
    setSelected((prev) => {
      const newSelected = [...prev, chosenIndex];
      // Scroll to the newly added lyric after state update
      setTimeout(() => {
        const lastLyricIdx = newSelected.length - 1;
        const el = lyricRefs.current[lastLyricIdx];
        if (el && !isPlaying) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50); // Small delay to ensure DOM has updated
      return newSelected;
    });
    // Prevent overlapping sounds: pause and clear any previous timeout
    stopAudio();
    // Play the corresponding sound for the chosen lyric
    const { startTime, endTime } = lyrics[chosenIndex];
    playAudioSegment(startTime, endTime - startTime);
  };

  // Play/stop functionality
  const playSegments = () => {
    // If already playing, stop and reset everything
    if (isPlayingRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      stopAudio();
      currentIndexRef.current = 0; // Reset to first segment
      setCurrentLyricIdx(null); // Clear highlight
      // Clear any scheduled timeouts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Only start playback if there are lyrics selected
    if (selected.length === 0) return;

    // Starting playback from the beginning
    setIsPlaying(true);
    isPlayingRef.current = true;
    currentIndexRef.current = 0; // Always start from first segment
    // Start playback from the beginning
    playNextSegment();
  };

  // Function to play the next segment
  const playNextSegment = () => {
    if (!isPlayingRef.current) return;

    if (currentIndexRef.current >= selected.length) {
      if (isRepeatModeRef.current) {
        currentIndexRef.current = 0;
        setTimeout(() => playNextSegment(), 0); // avoid call stack overflow
        return;
      } else {
        setIsPlaying(false); // Only set to false when ALL segments are done
        isPlayingRef.current = false;
        stopAudio();
        currentIndexRef.current = 0;
        setCurrentLyricIdx(null);
        return;
      }
    }

    const idx = selected[currentIndexRef.current];
    const { startTime, endTime } = lyrics[idx];

    setCurrentLyricIdx(currentIndexRef.current);

    // Play with Web Audio API
    playAudioSegment(startTime, endTime - startTime);

    // Schedule next segment
    const durationSec = (endTime - startTime) / 1000;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (!isPlayingRef.current) return;
      currentIndexRef.current += 1;
      playNextSegment();
    }, durationSec * 1000);
  };

  const handleShare = async () => {
    if (selected.length === 0) {
      alert('请先添加一些歌词再分享');
      return;
    }

    const shareUrl = window.location.href;

    try {
      if (navigator.share) {
        // Use native sharing API if available (mobile devices)
        await navigator.share({
          title: `${title} - 拼好歌`,
          text: '查看我创作的拼好歌',
          url: shareUrl,
        });
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(shareUrl);
        alert('分享链接已复制到剪贴板！');
      }
    } catch (error) {
      // If clipboard API fails, show the URL in an alert
      alert(`分享链接：\n${shareUrl}`);
    }
  };

  // Group selected indices into lines split by ⏎
  const lines: number[][] = [];
  let currentLine: number[] = [];
  selected.forEach((idx) => {
    if (lyrics[idx].lyric === '⏎') {
      currentLine.push(idx);
      if (currentLine.length > 0) lines.push(currentLine);
      currentLine = [];
    } else {
      currentLine.push(idx);
    }
  });
  if (currentLine.length > 0) lines.push(currentLine);

  // Add keyboard navigation
  useEffect(() => {
    // Make body focusable for global shortcuts
    document.body.tabIndex = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Always handle Escape to close the editor if open
      if (e.key === 'Escape') {
        if (isEditing) {
          setIsEditing(false);
          return;
        }
        // If editor is not open, blur any focused element to enable global shortcuts
        if (document.activeElement && document.activeElement !== document.body) {
          (document.activeElement as HTMLElement).blur();
          return;
        }
      }

      // Don't handle shortcuts when user is focused on editor buttons
      const isFocusedOnEditorButton =
        isEditing && document.activeElement?.closest('[role="region"][aria-label="歌词编辑器"]');

      // Don't handle shortcuts when focused on buttons
      const isFocusedOnButton = document.activeElement?.tagName === 'BUTTON';

      // Don't handle shortcuts when focused on form elements
      const isFocusedOnFormElement =
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT' ||
        document.activeElement?.tagName === 'A';

      // Handle global shortcuts when:
      // - Body is focused (default state), OR
      // - No problematic element is focused AND editor is closed
      const canUseGlobalShortcuts =
        document.activeElement === document.body ||
        (!isFocusedOnEditorButton && !isFocusedOnButton && !isFocusedOnFormElement && !isEditing);

      if (canUseGlobalShortcuts) {
        switch (e.key) {
          case ' ':
          case 'Enter':
            e.preventDefault();
            playSegments();
            break;
          case 'r':
          case 'R':
            e.preventDefault();
            setIsRepeatMode(!isRepeatMode);
            break;
          case 'e':
          case 'E':
            e.preventDefault();
            setIsEditing(!isEditing);
            break;
          case 's':
          case 'S':
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              handleShare();
            }
            break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Clean up: remove tabIndex from body
      document.body.removeAttribute('tabindex');
    };
  }, [isRepeatMode, isEditing, isPlaying, selected]); // Add 'selected' to dependency array

  // Announce status changes
  useEffect(() => {
    if (isPlaying) {
      setStatusMessage('开始播放歌词');
    } else if (statusMessage.includes('播放')) {
      setStatusMessage('停止播放');
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isEditing) {
      setStatusMessage('打开歌词编辑器');
    } else if (statusMessage.includes('编辑器')) {
      setStatusMessage('关闭歌词编辑器');
    }
  }, [isEditing]);

  // Media Session API integration
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title,
        artist,
        album: '拼好歌',
        artwork: [{ src: `${import.meta.env.BASE_URL}mashup.png`, sizes: '512x512', type: 'image/png' }],
      });
      navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler('stop', () => setIsPlaying(false));
      // Optionally add nexttrack, previoustrack, seekbackward, seekforward handlers
    }
  }, [title, artist]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  return (
    <div className="h-dvh text-rose-50 bg-gradient-to-b from-rose-900 to-rose-950">
      {/* Screen reader announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only" role="status">
        {statusMessage}
      </div>

      <div className="h-full flex flex-col">
        <header className="text-center py-3 flex-shrink-0 relative">
          <h1 className="text-2xl font-bold truncate px-6">{title}</h1>
          <p className="text-sm opacity-80 truncate px-6">{artist}</p>
        </header>
        <main
          className="flex-1 overflow-y-auto flex items-start justify-center relative mask-y-from-90% mask-y-to-100%"
          role="main"
          aria-label="歌词显示区域"
        >
          <section
            className="w-full max-w-xl px-4 py-2 text-center scrollbar-thin relative z-0"
            aria-live="polite"
            aria-label="当前歌词"
          >
            <div className="pt-[30vh] pb-[40vh]">
              {lines.length === 0 ? (
                <p className="opacity-60" role="status">
                  Made with Audacity 豆包 bolt.new GitHub Copilot
                </p>
              ) : (
                lines.map((line, lineIdx) => (
                  <div
                    key={lineIdx}
                    className="flex flex-wrap justify-center mb-2 w-full min-w-0"
                    role="group"
                    aria-label={`歌词第${lineIdx + 1}行`}
                  >
                    {line.map((idx, i) => {
                      const globalIdx = lines.slice(0, lineIdx).reduce((a, l) => a + l.length, 0) + i;
                      const lyricData = lyrics[idx];
                      const isActive = isPlaying
                        ? currentLyricIdx === globalIdx
                        : isEditing
                        ? globalIdx === selected.length - 1
                        : false;

                      // Find which line contains the current lyric
                      const currentLineIdx = isPlaying
                        ? lines.findIndex((line) =>
                            line.some((_, i) => {
                              const gIdx = lines.slice(0, lines.indexOf(line)).reduce((a, l) => a + l.length, 0) + i;
                              return gIdx === currentLyricIdx;
                            })
                          )
                        : -1;

                      const isCurrentLine = isPlaying && lineIdx === currentLineIdx;

                      // Find the position of current lyric within its line
                      const currentLyricPositionInLine = isCurrentLine
                        ? line.findIndex((_, j) => {
                            const gIdx = lines.slice(0, lineIdx).reduce((a, l) => a + l.length, 0) + j;
                            return gIdx === currentLyricIdx;
                          })
                        : -1;

                      // Is this a lyric that came before the current active one in the same line
                      const isCompletedInCurrentLine = isCurrentLine && i < currentLyricPositionInLine;

                      if (lyricData.lyric !== '⏎') {
                        // Determine if this line has already been completed (is before current line)
                        const currentLineIdx = isPlaying
                          ? lines.findIndex((line) =>
                              line.some((_, i) => {
                                const gIdx = lines.slice(0, lineIdx).reduce((a, l) => a + l.length, 0) + i;
                                return gIdx === currentLyricIdx;
                              })
                            )
                          : -1;

                        const isPreviousLine = isPlaying && lineIdx < currentLineIdx;

                        return (
                          <span
                            key={globalIdx}
                            ref={(el) => {
                              lyricRefs.current[globalIdx] = el;
                            }}
                            className={`py-2 text-lg inline-block transition-colors duration-300 ${
                              isPreviousLine
                                ? 'text-white/20' // Very dim for previous lines
                                : isActive
                                ? 'text-white' // Bright white for currently playing
                                : isCompletedInCurrentLine
                                ? 'text-white' // White for completed in current line
                                : 'text-white/60' // Dimmed for upcoming lyrics
                            }`}
                          >
                            {showEmoji && lyricData.emoji ? lyricData.emoji : lyricData.lyric}
                          </span>
                        );
                      }
                    })}
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
        {/* Footer with top blur overlay */}
        <footer className="flex flex-col items-center justify-center flex-shrink-0 relative" role="contentinfo">
          <nav className="flex gap-4 items-center my-4" role="toolbar" aria-label="播放控制">
            <button
              className={`flex items-center justify-center w-10 h-10 ${
                !showEmoji ? 'bg-white/15' : 'bg-transparent'
              } rounded-full hover:shadow-lg hover:bg-white/15 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50`}
              onClick={() => setShowEmoji((prev) => !prev)}
              aria-label={showEmoji ? '切换为文字歌词' : '切换为表情歌词'}
              aria-pressed={showEmoji}
              type="button"
            >
              {!showEmoji ? (
                <span role="img" aria-label="文字">
                  文
                </span>
              ) : (
                <span role="img" aria-label="表情">
                  😅
                </span>
              )}
            </button>
            {/* Repeat button: always visible */}
            <button
              className={`flex items-center justify-center w-10 h-10 ${
                isRepeatMode ? 'bg-white/15' : 'bg-transparent'
              } rounded-full hover:shadow-lg hover:bg-white/15 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50`}
              onClick={() => setIsRepeatMode(!isRepeatMode)}
              aria-label={isRepeatMode ? '关闭循环播放' : '开启循环播放'}
              aria-pressed={isRepeatMode}
              type="button"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
              </svg>
            </button>
            {/* Play/Stop button: always visible */}
            <button
              className="flex items-center justify-center w-16 h-16 bg-transparent rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
              onClick={playSegments}
              aria-label={isPlaying ? '停止播放' : '开始播放'}
              type="button"
            >
              {isPlaying ? (
                <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
                  <rect x="16" y="16" width="32" height="32" rx="4" />
                </svg>
              ) : (
                <svg fill="currentColor" viewBox="-80 -65.54 294.94 294.94" aria-hidden="true">
                  <g>
                    <path d="M34.857,3.613C20.084-4.861,8.107,2.081,8.107,19.106v125.637c0,17.042,11.977,23.975,26.75,15.509L144.67,97.275 c14.778-8.477,14.778-22.211,0-30.686L34.857,3.613z"></path>
                  </g>
                </svg>
              )}
            </button>
            <button
              className={`flex items-center justify-center w-10 h-10 ${
                isEditing ? 'bg-gradient-to-r from-lime-700 to-green-700' : 'bg-transparent hover:shadow-lg'
              } rounded-full hover:shadow-lg hover:bg-white/15 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50`}
              onClick={() => setIsEditing(!isEditing)}
              aria-label={isEditing ? '关闭编辑器' : '打开编辑器'}
              aria-expanded={isEditing}
              type="button"
            >
              {isEditing ? (
                // Confirm icon
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                // Edit icon
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              )}
            </button>
            <button
              className="flex items-center justify-center w-10 h-10 bg-transparent rounded-full hover:bg-white/15 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
              onClick={handleShare}
              aria-label="分享歌词混搭"
              type="button"
            >
              {/* Share icon */}
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7" />
                <path d="M16 6l-4-4-4 4" />
                <path d="M12 2v14" />
              </svg>
            </button>
          </nav>

          {/* Editor Panel (integrated into the main UI, not fixed) */}
          {isEditing && (
            <section
              className="shadow-lg rounded-xl p-4 transition-all duration-300 w-full max-w-lg mx-auto"
              role="region"
              aria-label="歌词编辑器"
              aria-live="polite"
            >
              <div>
                <div
                  className="flex flex-wrap justify-between gap-2 rounded-lg min-h-[120px]"
                  role="group"
                  aria-label="可选歌词列表"
                >
                  {Array.from(lyricsMap.keys())
                    .filter((lyricText) => lyricText !== '⏎')
                    .map((lyricText) => {
                      const firstIdx = lyricsMap.get(lyricText)?.[0];
                      const emoji = firstIdx !== undefined ? lyrics[firstIdx].emoji : undefined;
                      return (
                        <button
                          key={lyricText}
                          className="bg-white/5 border border-transparent rounded-lg px-3 py-2 text-center font-semibold cursor-pointer select-none transition hover:bg-transparent  text-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white/50"
                          onClick={() => addLyric(lyricText)}
                          aria-label={`添加歌词: ${lyricText}`}
                          type="button"
                          tabIndex={0}
                        >
                          {showEmoji && emoji ? emoji : lyricText}
                        </button>
                      );
                    })}
                  <div className="flex ml-auto gap-2" role="group" aria-label="编辑操作">
                    <button
                      className="flex items-center justify-center gap-2 px-5 py-2.5 min-w-[56px] bg-red-900 rounded-lg shadow hover:bg-red-700 transition-all duration-200 font-medium focus:outline-none focus:ring-2 focus:ring-red-400"
                      onClick={() => setSelected([])}
                      disabled={selected.length === 0}
                      aria-label="清空所有歌词"
                      type="button"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="sr-only">清空</span>
                    </button>
                    <button
                      className="bg-white/5 border border-transparent rounded-lg px-3 py-2 min-w-[56px] text-center font-semibold cursor-pointer select-none transition hover:bg-transparent  text-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white/50"
                      onClick={() => setSelected((prev) => prev.slice(0, -1))}
                      disabled={selected.length === 0}
                      aria-label="删除最后一个歌词"
                      type="button"
                    >
                      ⌫<span className="sr-only">退格</span>
                    </button>
                    <button
                      className="bg-white/5 border border-transparent rounded-lg px-3 py-2 min-w-[56px] text-center font-semibold cursor-pointer select-none transition hover:bg-transparent  text-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white/50"
                      onClick={() => addLyric('⏎')}
                      aria-label="添加换行"
                      type="button"
                    >
                      ⏎<span className="sr-only">换行</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </footer>
      </div>
    </div>
  );
}

export default App;
